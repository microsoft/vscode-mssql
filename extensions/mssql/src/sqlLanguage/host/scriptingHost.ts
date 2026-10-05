/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Strict scripting host flow (CACHE-6; cache/drift design §10.3/§16,
 * addendum §7.5): the ONE place where user-facing CREATE/ALTER/DML script
 * generation meets the metadata lease. Before scripting, the host resolves
 * ensureFresh(MetadataPolicies.scriptingStrict) — or the explicit
 * offlineSnapshot policy when mssql.metadataCache.offlineMode is active —
 * and hands the resulting provenance INTO the pure engine as request data
 * (the CACHE-5 diagnostics-verdict pattern). The engine derives the honest
 * refusal (freshness "unavailable" ⇒ actionable error mentioning refresh)
 * and the base §16.3 offline banner from that ONE FreshCatalogResult, so
 * banner, refusal, ScriptResult.provenance, and telemetry can never
 * disagree.
 *
 * The wait budget is a race, never a cancellation (addendum C-9); the
 * host-side backstop below guarantees a misbehaving lease can never block a
 * script request past the budget — on miss the flow refuses, it does not
 * hang. The definition/peek path deliberately does NOT ride this flow
 * (consumer matrix §6): it keeps its lazy live module reads and the
 * provider seam's own honesty ladder.
 */

import { RawField, diag } from "../../diagnostics/diagnosticsCore";
import {
    FreshCatalogResult,
    MetadataFreshnessPolicy,
    MetadataPolicies,
} from "../../services/metadata/cache/metadataFreshness";
import {
    ScriptMetadataProvenance,
    ScriptRequest,
    ScriptResult,
    SqlScriptingService,
} from "../../sqlScripting/api";
import { SqlScriptingEngine } from "../../sqlScripting/scriptingService";
import { IPinnedMetadataView } from "../provider/types";

/** Base §16.2 scripting row: offline mode is explicit snapshot use. */
export const OFFLINE_SCRIPTING_POLICY: MetadataFreshnessPolicy = {
    mode: "offlineSnapshot",
    reason: "scripting",
};

/** The lease surface the strict flow consumes (DatabaseCatalogLease slice). */
export interface StrictScriptingLease {
    ensureFresh(policy: MetadataFreshnessPolicy): Promise<FreshCatalogResult>;
}

export interface StrictScriptingHost {
    /** The bound metadata lease; undefined = nothing to validate (the
     *  provider readiness ladder owns honesty then). */
    lease(): StrictScriptingLease | undefined;
    /** Pinned AFTER the freshness decision so "live" pins the refreshed
     *  generation (§7.5: the provenance describes THIS pin). */
    pin(): IPinnedMetadataView;
    /** Live read of mssql.metadataCache.offlineMode (base §16). */
    offlineMode(): boolean;
    /** Test seam: strict-policy override (defaults to scriptingStrict). */
    strictPolicy?: MetadataFreshnessPolicy;
}

/** Map the FreshCatalogResult onto the engine's provenance shape (§7.5). */
export function scriptProvenanceOf(fresh: FreshCatalogResult): ScriptMetadataProvenance {
    return {
        generation: fresh.generation,
        ...(fresh.contentHash !== undefined ? { contentHash: fresh.contentHash } : {}),
        source: fresh.source,
        freshness: fresh.freshness,
        ...(fresh.capturedAtUtc !== undefined ? { capturedAtUtc: fresh.capturedAtUtc } : {}),
    };
}

/**
 * Strict-by-default scripting service (base §10.3): ensureFresh first, then
 * script over the freshly pinned generation with the verdict as data.
 */
export function createStrictScriptingService(host: StrictScriptingHost): SqlScriptingService {
    return withScriptingSpans({
        capabilities: (target) => new SqlScriptingEngine(host.pin()).capabilities(target),
        script: async (request: ScriptRequest): Promise<ScriptResult> => {
            const lease = host.lease();
            if (lease === undefined) {
                // No lease bound — no live metadata to validate against;
                // the pinned view is offline/empty and the engine already
                // reports that honestly (no provenance claim is made).
                return new SqlScriptingEngine(host.pin()).script(request);
            }
            const offline = host.offlineMode();
            const policy = offline
                ? OFFLINE_SCRIPTING_POLICY
                : (host.strictPolicy ?? MetadataPolicies.scriptingStrict);
            const fresh = await boundedEnsureFresh(lease, policy);
            const pinned = host.pin();
            const provenance: ScriptMetadataProvenance =
                fresh !== undefined
                    ? scriptProvenanceOf(fresh)
                    : {
                          // Lease misbehaved (rejection/overrun): strict
                          // callers refuse on freshness (addendum C-7).
                          generation: pinned.generation,
                          source: offline ? "offline" : "none",
                          freshness: "unavailable",
                      };
            return new SqlScriptingEngine(pinned).script({ ...request, provenance });
        },
    });
}

/**
 * ensureFresh with a host-side backstop: the policy timeout is already a
 * race (C-9), but a lease that never settles must still never block the
 * caller. Rejections and overruns both resolve undefined — the strict flow
 * refuses rather than throws.
 */
async function boundedEnsureFresh(
    lease: StrictScriptingLease,
    policy: MetadataFreshnessPolicy,
): Promise<FreshCatalogResult | undefined> {
    const backstopMs = (policy.timeoutMs ?? 15_000) + 250;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            lease.ensureFresh(policy),
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), backstopMs);
            }),
        ]);
    } catch {
        return undefined;
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

/**
 * Wrap the pure scripting engine with sqlScripting.script spans (host-side —
 * the engine itself is pure). Fields: object kind, operation, fidelity,
 * anchor count, source, unavailable reason, and the CACHE-6 provenance
 * enums (freshness/source/generation) — never script text or names.
 */
export function withScriptingSpans(engine: SqlScriptingService): SqlScriptingService {
    return {
        capabilities: (target) => engine.capabilities(target),
        script: async (request: ScriptRequest): Promise<ScriptResult> => {
            const span = diag.startSpan({
                feature: "sqlLanguage",
                kind: "span",
                type: "sqlScripting.script",
                fields: {
                    operation: { raw: request.operation, cls: "diagnostic.metadata" },
                },
            });
            try {
                const result = await engine.script(request);
                span.end("ok", {
                    objectKind: { raw: result.objectKind, cls: "diagnostic.metadata" },
                    fidelity: { raw: result.fidelity, cls: "diagnostic.metadata" },
                    scriptSource: { raw: result.source, cls: "diagnostic.metadata" },
                    anchorCount: { raw: result.anchors.length, cls: "diagnostic.metadata" },
                    noteCount: { raw: result.fidelityNotes.length, cls: "diagnostic.metadata" },
                    unavailableReason: {
                        raw: result.unavailableReason ?? "none",
                        cls: "diagnostic.metadata",
                    },
                    ...provenanceSpanFields(result),
                });
                return result;
            } catch (error) {
                span.fail(error);
                throw error;
            }
        },
    };
}

/** Provenance enums for the span — banner/telemetry share ONE source. */
function provenanceSpanFields(result: ScriptResult): Record<string, RawField> {
    if (result.provenance === undefined) {
        return {};
    }
    return {
        metadataFreshness: { raw: result.provenance.freshness, cls: "diagnostic.metadata" },
        metadataSource: { raw: result.provenance.source, cls: "diagnostic.metadata" },
        metadataGeneration: { raw: result.provenance.generation, cls: "diagnostic.metadata" },
    };
}
