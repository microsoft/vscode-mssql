/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Freshness policy API (cache/drift design §5, review addendum §4/App A):
 * consumers declare how current metadata must be; the store decides whether
 * to serve the known snapshot, validate it, refresh it, or refuse.
 *
 * SCOPE OF `sections` IN v1 (addendum C-12): the engine hydrates via the
 * whole H-ladder — per-section hydration does NOT exist until CACHE-7
 * (T2/T3 digests). Until then `policy.sections` means exactly two things:
 * (a) the readiness gate deciding whether the returned snapshot can satisfy
 * the caller (`allowPartial` interplay), and (b) once T1 manifest digests
 * exist, which section digests participate in the compare. Any refresh a
 * v1 policy triggers is a full-ladder refresh.
 *
 * TIMEOUTS ARE A RACE, NEVER A CANCELLATION (addendum C-9): multiple
 * consumers coalesce onto the same entry's validation/hydration, so a
 * policy timeout (or an aborted `signal`) only stops THIS caller's wait —
 * the shared lane work always runs to completion for the other waiters and
 * for background refresh. On timeout: `requireLive` resolves freshness
 * "unavailable"; `requireValidated` resolves with the best snapshot,
 * freshness "stale", validation "notChecked".
 *
 * Readiness and freshness are SEPARATE dimensions (addendum C-3): the
 * as-built `MetadataStatus.readiness` vocabulary is untouched — its
 * "stale" means "re-hydration in flight over an existing snapshot", never
 * "old data". Age-based staleness is expressed ONLY through
 * `FreshCatalogResult.freshness` and the cache status blocks.
 */

import { CatalogSection, CatalogSnapshot, ObjectKind } from "../catalogModel";

export type MetadataFreshnessMode =
    | "allowStale"
    | "requireValidated"
    | "requireLive"
    | "offlineSnapshot";

export type MetadataFreshnessReason =
    | "completion"
    | "aiContext"
    | "hover"
    | "diagnostics"
    | "definition"
    | "oeBrowse"
    | "oeRefresh"
    | "oeSearch"
    | "scripting"
    | "manualRefresh"
    | "startupWarm";

export interface MetadataObjectIdentity {
    readonly objectId?: number;
    readonly database?: string;
    readonly schema?: string;
    readonly name?: string;
    readonly kind?: ObjectKind;
}

export interface MetadataFreshnessPolicy {
    readonly mode: MetadataFreshnessMode;
    readonly reason: MetadataFreshnessReason;
    /** v1: readiness gate + validation scope ONLY — see header (C-12). */
    readonly sections?: readonly CatalogSection[];
    readonly objects?: readonly MetadataObjectIdentity[];
    /**
     * For allowStale this is a BACKGROUND-REFRESH trigger, never a reason
     * to withhold the snapshot (addendum §4.1): an old snapshot still
     * serves; it just also schedules refresh and reports staleAgeMs.
     */
    readonly maxStalenessMs?: number;
    readonly validationTtlMs?: number;
    readonly allowPartial?: boolean;
    readonly allowDiskLoad?: boolean;
    readonly backgroundRefresh?: boolean;
    /** Wait budget for THIS caller — a race, never a cancellation (C-9). */
    readonly timeoutMs?: number;
    /** Aborting stops this caller's wait with identical race semantics. */
    readonly signal?: AbortSignal;
}

export type MetadataValidationTier =
    | "none"
    | "memoryTtl"
    | "cheapDatabaseDigest"
    | "sectionDigest"
    | "objectDigest"
    | "fullRefresh";

export type MetadataStaleReason =
    | "ttlExpired"
    | "ddlSniff"
    | "digestMismatch"
    | "sectionMismatch"
    | "objectMismatch"
    | "permissionChanged"
    | "accessChanged"
    | "cachePolicyChanged"
    | "unknown";

export interface MetadataValidationSummary {
    readonly validatedAtUtc?: string;
    readonly tier: MetadataValidationTier;
    readonly result: "notChecked" | "unchanged" | "changed" | "failed" | "unsupported";
    readonly staleReason?: MetadataStaleReason;
    readonly durationMs?: number;
}

/**
 * Freshness vocabulary (addendum C-8): "live" = produced by a refresh
 * completed for this call; "validated" = TTL/digest-confirmed;
 * "refreshing" = returned early while shared work continues (only
 * allowStale produces it); "stale" = known-unvalidated; "unavailable" =
 * the policy's bar was not met (a snapshot may STILL be present — strict
 * callers refuse on freshness, and can offer the explicit offline path).
 */
export interface FreshCatalogResult {
    readonly snapshot: CatalogSnapshot | undefined;
    readonly generation: number;
    /** Canonical content hash (C-2) — lands with the CACHE-1 codec. */
    readonly contentHash?: string;
    /** "none" ⇔ snapshot undefined. */
    readonly source: "memory" | "disk" | "live" | "offline" | "none";
    readonly freshness: "live" | "validated" | "stale" | "refreshing" | "unavailable";
    readonly capturedAtUtc?: string;
    readonly staleAgeMs?: number;
    /** How long ensureFresh blocked this caller (perf-gate fuel). */
    readonly waitedMs: number;
    readonly validation?: MetadataValidationSummary;
    readonly backgroundRefreshStarted?: boolean;
}

// -- Server catalog (addendum §4.4: no digest at server scope — validation
// -- IS re-hydration; requireValidated re-hydrates when older than TTL).

export interface ServerMetadataFreshnessPolicy {
    readonly mode: MetadataFreshnessMode;
    readonly reason: MetadataFreshnessReason;
    readonly validationTtlMs?: number;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
}

export interface FreshServerCatalogResult {
    readonly generation: number;
    readonly readiness: "absent" | "loading" | "ready" | "failed";
    readonly freshness: FreshCatalogResult["freshness"];
    readonly waitedMs: number;
    readonly backgroundRefreshStarted?: boolean;
}

/**
 * Policy presets (base design §5.3) — consumers reference these instead of
 * inventing knobs. Values are dogfood defaults; they become settings only
 * after measurement and UX validation.
 */
export const MetadataPolicies = {
    completion: {
        mode: "allowStale",
        reason: "completion",
        allowDiskLoad: true,
        backgroundRefresh: true,
        // Background-refresh trigger only — a 31-day-old snapshot still
        // serves the completion; it just also schedules a refresh.
        maxStalenessMs: 30 * 24 * 60 * 60_000,
    },
    aiContext: {
        mode: "allowStale",
        reason: "aiContext",
        allowDiskLoad: true,
        backgroundRefresh: true,
        maxStalenessMs: 7 * 24 * 60 * 60_000,
    },
    diagnosticsBinder: {
        mode: "requireValidated",
        reason: "diagnostics",
        sections: ["objects", "columns"],
        validationTtlMs: 60_000,
        // Wait budget per C-9 — on miss diagnostics SUPPRESS, never block.
        timeoutMs: 250,
        allowPartial: false,
    },
    oeBrowse: {
        mode: "requireValidated",
        reason: "oeBrowse",
        validationTtlMs: 120_000,
        timeoutMs: 5_000,
    },
    scriptingStrict: {
        mode: "requireLive",
        reason: "scripting",
        timeoutMs: 15_000,
        allowPartial: false,
    },
} as const satisfies Record<string, MetadataFreshnessPolicy>;

/** Fixed stale-age buckets (addendum §8.4) so dashboards do not fork. */
export function staleAgeBucket(ageMs: number): string {
    if (ageMs < 60_000) {
        return "<1m";
    }
    if (ageMs < 600_000) {
        return "<10m";
    }
    if (ageMs < 3_600_000) {
        return "<1h";
    }
    if (ageMs < 86_400_000) {
        return "<1d";
    }
    if (ageMs < 7 * 86_400_000) {
        return "<7d";
    }
    if (ageMs < 30 * 86_400_000) {
        return "<30d";
    }
    return ">=30d";
}
