/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryResults parameter registry (C2D, addendum §6 — QO invariant 11
 * applied): no perf-relevant constant lands unregistered. These are
 * service-lifetime knobs (not per-run QueryTuning params), resolved from
 * `mssql.queryResults.*` settings with a single `mssql.queryResults.overrides`
 * object as the perftest per-combo carrier, mirroring
 * `mssql.queryStudio.tuning.overrides` so spread runs sweep both identically.
 *
 * The digest is a salt-free hash over resolved params in canonical order —
 * the same comparability story as tuningDigest.
 */

import * as crypto from "crypto";
import * as vscode from "vscode";

export interface QueryResultsParams {
    /** Unleased AI/chat snapshot lifetime before the sweep may dispose it. */
    snapshotTtlMinutes: number;
    /** Max retained stores with zero pinned-document leases. */
    maxUnpinnedStores: number;
    /** Global retained budget (memory+spill, deduped by store). */
    maxRetainedBytesMb: number;
    /** Memory ceiling applied to a store once its live owner releases. */
    retainedStoreMemoryBytes: number;
    /** `includeMessages: "allLocal"` copies at most this many rows. */
    maxLocalMessages: number;
    /** Retention sweep cadence. */
    sweepIntervalSeconds: number;
    /** Policy switches (not swept). */
    pinnedDocumentsEnabled: boolean;
    aiEnabled: boolean;
}

export const QUERY_RESULTS_DEFAULTS: QueryResultsParams = {
    snapshotTtlMinutes: 30,
    maxUnpinnedStores: 10,
    maxRetainedBytesMb: 2048,
    retainedStoreMemoryBytes: 8 * 1024 * 1024,
    maxLocalMessages: 5000,
    sweepIntervalSeconds: 60,
    pinnedDocumentsEnabled: true,
    aiEnabled: true,
};

/** Append new keys at the tail of their group; order is the digest contract. */
export const QUERY_RESULTS_KEYS: ReadonlyArray<keyof QueryResultsParams> = [
    "snapshotTtlMinutes",
    "maxUnpinnedStores",
    "maxRetainedBytesMb",
    "retainedStoreMemoryBytes",
    "maxLocalMessages",
    "sweepIntervalSeconds",
    "pinnedDocumentsEnabled",
    "aiEnabled",
];

const NUMERIC_RANGES: Partial<Record<keyof QueryResultsParams, { min: number; max: number }>> = {
    snapshotTtlMinutes: { min: 1, max: 24 * 60 },
    maxUnpinnedStores: { min: 0, max: 100 },
    maxRetainedBytesMb: { min: 64, max: 64 * 1024 },
    retainedStoreMemoryBytes: { min: 1024 * 1024, max: 1024 * 1024 * 1024 },
    maxLocalMessages: { min: 0, max: 1_000_000 },
    sweepIntervalSeconds: { min: 5, max: 3600 },
};

const SETTING_SECTIONS: Record<keyof QueryResultsParams, string> = {
    snapshotTtlMinutes: "mssql.queryResults.snapshot.ttlMinutes",
    maxUnpinnedStores: "mssql.queryResults.snapshot.maxUnpinnedStores",
    maxRetainedBytesMb: "mssql.queryResults.snapshot.maxRetainedBytesMb",
    retainedStoreMemoryBytes: "mssql.queryResults.retainedStoreMemoryBytes",
    maxLocalMessages: "mssql.queryResults.snapshot.maxLocalMessages",
    sweepIntervalSeconds: "mssql.queryResults.snapshot.sweepIntervalSeconds",
    pinnedDocumentsEnabled: "mssql.queryResults.pinnedDocuments.enabled",
    aiEnabled: "mssql.queryResults.ai.enabled",
};

export const QUERY_RESULTS_OVERRIDES_SETTING = "mssql.queryResults.overrides";

export interface QueryResultsSnapshotParams {
    readonly params: Readonly<QueryResultsParams>;
    readonly digest: string;
    readonly overriddenKeys: ReadonlyArray<keyof QueryResultsParams>;
}

/** Injectable settings reader — tests pass a fake; product uses VS Code config. */
export interface QueryResultsSettingsReader {
    get(section: string): unknown;
}

const vscodeSettingsReader: QueryResultsSettingsReader = {
    get: (section) => vscode.workspace.getConfiguration().get(section),
};

function normalizeValue(
    key: keyof QueryResultsParams,
    raw: unknown,
): QueryResultsParams[keyof QueryResultsParams] | undefined {
    const fallback = QUERY_RESULTS_DEFAULTS[key];
    if (typeof fallback === "boolean") {
        return typeof raw === "boolean" ? raw : undefined;
    }
    const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : undefined;
    if (value === undefined) {
        return undefined;
    }
    const range = NUMERIC_RANGES[key];
    return range ? Math.min(range.max, Math.max(range.min, value)) : value;
}

export function resolveQueryResultsParams(
    reader: QueryResultsSettingsReader = vscodeSettingsReader,
): QueryResultsSnapshotParams {
    const overridesRaw = reader.get(QUERY_RESULTS_OVERRIDES_SETTING);
    const overrides =
        overridesRaw && typeof overridesRaw === "object"
            ? (overridesRaw as Record<string, unknown>)
            : {};
    const draft: Record<string, number | boolean> = {};
    const overriddenKeys: Array<keyof QueryResultsParams> = [];
    for (const key of QUERY_RESULTS_KEYS) {
        const overridden = normalizeValue(key, overrides[key]);
        if (overridden !== undefined) {
            overriddenKeys.push(key);
            draft[key] = overridden;
            continue;
        }
        draft[key] =
            normalizeValue(key, reader.get(SETTING_SECTIONS[key])) ?? QUERY_RESULTS_DEFAULTS[key];
    }
    const params = Object.freeze(draft as unknown as QueryResultsParams);
    return { params, digest: computeQueryResultsDigest(params), overriddenKeys };
}

/** Stable digest — numbers/booleans only, safe for diagnostics attrs. */
export function computeQueryResultsDigest(params: QueryResultsParams): string {
    const canonical = QUERY_RESULTS_KEYS.map((key) => `${key}=${String(params[key])}`).join(";");
    return crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
}
