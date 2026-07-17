/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-6 strict scripting host suite (cache/drift design §10.3/§16,
 * addendum §7.5): the host resolves ensureFresh BEFORE scripting and hands
 * the verdict into the pure engine as provenance data.
 *
 * - online: ensureFresh(MetadataPolicies.scriptingStrict); "live" scripts
 *   normally with NO banner; refresh failure/timeout refuses with an
 *   actionable error mentioning refresh (never a silent stale script);
 * - offline: ensureFresh({mode:"offlineSnapshot", reason:"scripting"});
 *   generated scripts carry the EXACT base §16.3 three-line banner derived
 *   from the same FreshCatalogResult as ScriptResult.provenance;
 * - a lease that rejects or never settles yields a bounded refusal — the
 *   wait budget is a race (C-9), never a hang and never a throw.
 */

import { expect } from "chai";
import {
    FreshCatalogResult,
    MetadataFreshnessPolicy,
    MetadataPolicies,
} from "../../src/services/metadata/cache/metadataFreshness";
import {
    OFFLINE_SCRIPTING_POLICY,
    createStrictScriptingService,
    scriptProvenanceOf,
} from "../../src/sqlLanguage/host/scriptingHost";
import { FixtureLanguageMetadataProvider } from "../../src/sqlLanguage/provider/fixtureProvider";
import { IPinnedMetadataView } from "../../src/sqlLanguage/provider/types";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";
import { ScriptResult, SqlScriptingService } from "../../src/sqlScripting/api";

const OFFLINE_BANNER = [
    "-- Generated from offline metadata snapshot.",
    "-- Snapshot captured at 2026-07-06T15:12:03Z.",
    "-- Live drift validation was not performed.",
];

function freshOf(overrides: Partial<FreshCatalogResult>): FreshCatalogResult {
    return {
        snapshot: undefined,
        generation: 1,
        source: "memory",
        freshness: "validated",
        waitedMs: 0,
        ...overrides,
    };
}

interface StrictHarness {
    readonly service: SqlScriptingService;
    readonly policies: MetadataFreshnessPolicy[];
    readonly pinned: IPinnedMetadataView;
    setEnsureFresh(impl: (policy: MetadataFreshnessPolicy) => Promise<FreshCatalogResult>): void;
}

function strictHarness(options?: {
    offline?: boolean;
    noLease?: boolean;
    strictPolicy?: MetadataFreshnessPolicy;
}): StrictHarness {
    const provider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);
    const pinned = provider.pin();
    const policies: MetadataFreshnessPolicy[] = [];
    let impl: (policy: MetadataFreshnessPolicy) => Promise<FreshCatalogResult> = () =>
        Promise.resolve(freshOf({ source: "live", freshness: "live" }));
    const lease = {
        ensureFresh: (policy: MetadataFreshnessPolicy): Promise<FreshCatalogResult> => {
            policies.push(policy);
            return impl(policy);
        },
    };
    const service = createStrictScriptingService({
        lease: () => (options?.noLease === true ? undefined : lease),
        pin: () => provider.pin(),
        offlineMode: () => options?.offline === true,
        ...(options?.strictPolicy !== undefined ? { strictPolicy: options.strictPolicy } : {}),
    });
    return {
        service,
        policies,
        pinned,
        setEnsureFresh: (next): void => {
            impl = next;
        },
    };
}

function refOf(pinned: IPinnedMetadataView, schema: string, name: string) {
    const resolution = pinned.resolveObject([schema, name]);
    if (resolution.kind !== "resolved") {
        throw new Error(`fixture object ${schema}.${name} did not resolve`);
    }
    return resolution.ref;
}

function scriptOrders(harness: StrictHarness): Promise<ScriptResult> {
    return harness.service.script({
        target: { ref: refOf(harness.pinned, "Sales", "Orders") },
        operation: "create",
    });
}

suite("sqlScripting strict host flow (CACHE-6 §10.3)", () => {
    test("online: ensureFresh is called with the scriptingStrict preset", async () => {
        const harness = strictHarness();
        await scriptOrders(harness);
        expect(harness.policies).to.have.length(1);
        expect(harness.policies[0]).to.equal(MetadataPolicies.scriptingStrict);
        expect(harness.policies[0].mode).to.equal("requireLive");
        expect(harness.policies[0].reason).to.equal("scripting");
        expect(harness.policies[0].timeoutMs).to.equal(15_000);
        expect(harness.policies[0].allowPartial).to.equal(false);
    });

    test("live verdict: scripts normally, provenance stamped, NO banner", async () => {
        const harness = strictHarness();
        harness.setEnsureFresh(() =>
            Promise.resolve(
                freshOf({
                    generation: 4,
                    contentHash: "ch_live4",
                    source: "live",
                    freshness: "live",
                    capturedAtUtc: "2026-07-06T16:00:00Z",
                }),
            ),
        );
        const result = await scriptOrders(harness);
        expect(result.unavailableReason).to.equal(undefined);
        expect(result.text).to.contain("CREATE TABLE Sales.Orders (");
        expect(result.text).to.not.contain("offline metadata snapshot");
        expect(result.provenance).to.deep.equal({
            generation: 4,
            contentHash: "ch_live4",
            source: "live",
            freshness: "live",
            capturedAtUtc: "2026-07-06T16:00:00Z",
        });
    });

    test("unavailable ONLINE (refresh failed/timed out): refusal mentioning refresh", async () => {
        const harness = strictHarness();
        harness.setEnsureFresh(() =>
            Promise.resolve(freshOf({ source: "memory", freshness: "unavailable" })),
        );
        const result = await scriptOrders(harness);
        expect(result.unavailableReason).to.equal("notValidated");
        expect(result.text).to.contain("refresh");
        expect(result.text).to.contain("mssql.metadataCache.offlineMode");
        expect(result.text).to.not.contain("CREATE TABLE");
    });

    test("offline mode: the offlineSnapshot policy is used, reason scripting", async () => {
        const harness = strictHarness({ offline: true });
        harness.setEnsureFresh(() =>
            Promise.resolve(freshOf({ source: "offline", freshness: "stale" })),
        );
        await scriptOrders(harness);
        expect(harness.policies).to.have.length(1);
        expect(harness.policies[0]).to.equal(OFFLINE_SCRIPTING_POLICY);
        expect(harness.policies[0].mode).to.equal("offlineSnapshot");
        expect(harness.policies[0].reason).to.equal("scripting");
    });

    test("offline snapshot: EXACT three banner lines + capturedAtUtc, provenance agrees", async () => {
        const harness = strictHarness({ offline: true });
        harness.setEnsureFresh(() =>
            Promise.resolve(
                freshOf({
                    generation: 5,
                    contentHash: "ch_disk5",
                    source: "offline",
                    freshness: "stale",
                    capturedAtUtc: "2026-07-06T15:12:03Z",
                }),
            ),
        );
        const result = await scriptOrders(harness);
        expect(result.text.split("\r\n").slice(0, 3)).to.deep.equal(OFFLINE_BANNER);
        expect(result.text).to.contain("CREATE TABLE Sales.Orders (");
        expect(result.provenance).to.deep.equal({
            generation: 5,
            contentHash: "ch_disk5",
            source: "offline",
            freshness: "stale",
            capturedAtUtc: "2026-07-06T15:12:03Z",
        });
    });

    test("offline with NO snapshot: honest offline refusal, no banner", async () => {
        const harness = strictHarness({ offline: true });
        harness.setEnsureFresh(() =>
            Promise.resolve(
                freshOf({ generation: 0, source: "offline", freshness: "unavailable" }),
            ),
        );
        const result = await scriptOrders(harness);
        expect(result.unavailableReason).to.equal("offline");
        expect(result.text).to.contain("offline mode is active");
        expect(result.text).to.not.contain("Generated from offline metadata snapshot");
    });

    test("ensureFresh rejection: bounded refusal, never a throw", async () => {
        const harness = strictHarness();
        harness.setEnsureFresh(() => Promise.reject(new Error("lane failed")));
        const result = await scriptOrders(harness);
        expect(result.unavailableReason).to.equal("notValidated");
        expect(result.provenance?.freshness).to.equal("unavailable");
        expect(result.provenance?.source).to.equal("none");
    });

    test("a lease that never settles cannot block past the wait budget", async function () {
        this.timeout(10_000);
        const harness = strictHarness({
            strictPolicy: { ...MetadataPolicies.scriptingStrict, timeoutMs: 50 },
        });
        harness.setEnsureFresh(() => new Promise<FreshCatalogResult>(() => undefined)); // never
        const startedAt = Date.now();
        const result = await scriptOrders(harness);
        expect(Date.now() - startedAt, "must refuse within the backstop").to.be.below(5_000);
        expect(result.unavailableReason).to.equal("notValidated");
        expect(result.text).to.contain("refresh");
    });

    test("no lease bound: engine behavior unchanged, no provenance claim", async () => {
        const harness = strictHarness({ noLease: true });
        const result = await scriptOrders(harness);
        expect(harness.policies).to.have.length(0);
        expect(result.text).to.contain("CREATE TABLE Sales.Orders (");
        expect(result.provenance).to.equal(undefined);
    });

    test("capabilities never trigger ensureFresh (cheap, non-strict)", () => {
        const harness = strictHarness();
        const operations = harness.service.capabilities({
            ref: refOf(harness.pinned, "Sales", "Orders"),
        });
        expect(operations).to.deep.equal([
            "create",
            "drop",
            "selectTop",
            "insert",
            "update",
            "delete",
        ]);
        expect(harness.policies).to.have.length(0);
    });

    test("scriptProvenanceOf maps FreshCatalogResult 1:1 and omits absent optionals", () => {
        expect(
            scriptProvenanceOf(
                freshOf({
                    generation: 9,
                    source: "disk",
                    freshness: "validated",
                }),
            ),
        ).to.deep.equal({ generation: 9, source: "disk", freshness: "validated" });
        expect(
            scriptProvenanceOf(
                freshOf({
                    generation: 2,
                    contentHash: "ch",
                    source: "live",
                    freshness: "live",
                    capturedAtUtc: "2026-07-06T15:12:03Z",
                }),
            ),
        ).to.deep.equal({
            generation: 2,
            contentHash: "ch",
            source: "live",
            freshness: "live",
            capturedAtUtc: "2026-07-06T15:12:03Z",
        });
    });
});
