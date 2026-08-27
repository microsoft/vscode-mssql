/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Metadata cache settings (CACHE-2; cache/drift design §13, addendum §5.6):
 * a PURE config shape with defaults, plus a thin adapter that reads
 * `mssql.metadataCache.*` through an INJECTED accessor — this module never
 * imports vscode, so unit tests construct settings directly and the CACHE-3
 * host wiring passes a closure over workspace configuration.
 *
 * `policyId` is derived from the persist flags: two manifests written under
 * different privacy policies compare unequal even when the structural
 * content matches, so the coordinator's §5.5 skip-save and C-5 intersection
 * can reason about policy drift without inspecting payloads.
 */

export interface MetadataCacheSettings {
    /** Master switch — default OFF until the §22 acceptance gates pass. */
    readonly enabled: boolean;
    /** Disk entries older than this are evicted (base §15.2 age tier). */
    readonly maxAgeDays: number;
    /** Total disk budget across all entries (LRU eviction above it). */
    readonly maxBytes: number;
    /** Per-entry compressed cap (H-7): larger snapshots skip the save. */
    readonly maxEntryBytes: number;
    /** Save debounce (base §14): coalesce refresh bursts into one write. */
    readonly writeDelayMs: number;
    /** Persist MS_Description rows (privacy-gated; base §8.2). */
    readonly persistDescriptions: boolean;
    /** Persist module definitions — NEVER honored by payload v1 (C-5.3). */
    readonly persistModuleDefinitions: boolean;
    /** Explicit offline snapshot mode (base §16) — a mode, not an accident. */
    readonly offlineMode: boolean;
    /** Derived from the persist flags — see cachePolicyId(). */
    readonly policyId: string;
}

/** Privacy policy identity derived from the persist flags. */
export function cachePolicyId(flags: {
    readonly persistDescriptions: boolean;
    readonly persistModuleDefinitions: boolean;
}): string {
    return `cp1:d${flags.persistDescriptions ? 1 : 0}m${flags.persistModuleDefinitions ? 1 : 0}`;
}

export const DEFAULT_METADATA_CACHE_SETTINGS: MetadataCacheSettings = Object.freeze({
    enabled: false,
    maxAgeDays: 14,
    maxBytes: 268_435_456, // 256 MiB
    maxEntryBytes: 33_554_432, // 32 MiB compressed (H-7; revisit after measurement)
    writeDelayMs: 5_000,
    persistDescriptions: false,
    persistModuleDefinitions: false,
    offlineMode: false,
    policyId: cachePolicyId({ persistDescriptions: false, persistModuleDefinitions: false }),
});

/**
 * Injected host accessor: the CACHE-3 wiring passes
 * `(key, dflt) => vscode.workspace.getConfiguration("mssql.metadataCache").get(key, dflt)`;
 * unit tests pass a plain lookup. Returning a wrong-typed or non-finite
 * value falls back to the default — settings never throw.
 */
export type MetadataCacheSettingsAccessor = (
    key: string,
    defaultValue: boolean | number,
) => unknown;

function readBoolean(accessor: MetadataCacheSettingsAccessor, key: string, dflt: boolean): boolean {
    const value = accessor(key, dflt);
    return typeof value === "boolean" ? value : dflt;
}

function readPositiveNumber(
    accessor: MetadataCacheSettingsAccessor,
    key: string,
    dflt: number,
): number {
    const value = accessor(key, dflt);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : dflt;
}

/** Read mssql.metadataCache.* through the injected accessor. */
export function readMetadataCacheSettings(
    accessor: MetadataCacheSettingsAccessor,
): MetadataCacheSettings {
    const defaults = DEFAULT_METADATA_CACHE_SETTINGS;
    const persistDescriptions = readBoolean(
        accessor,
        "persistDescriptions",
        defaults.persistDescriptions,
    );
    const persistModuleDefinitions = readBoolean(
        accessor,
        "persistModuleDefinitions",
        defaults.persistModuleDefinitions,
    );
    return {
        enabled: readBoolean(accessor, "enabled", defaults.enabled),
        maxAgeDays: readPositiveNumber(accessor, "maxAgeDays", defaults.maxAgeDays),
        maxBytes: readPositiveNumber(accessor, "maxBytes", defaults.maxBytes),
        maxEntryBytes: readPositiveNumber(accessor, "maxEntryBytes", defaults.maxEntryBytes),
        writeDelayMs: readPositiveNumber(accessor, "writeDelayMs", defaults.writeDelayMs),
        persistDescriptions,
        persistModuleDefinitions,
        offlineMode: readBoolean(accessor, "offlineMode", defaults.offlineMode),
        policyId: cachePolicyId({ persistDescriptions, persistModuleDefinitions }),
    };
}
