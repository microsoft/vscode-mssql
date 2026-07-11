/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryTuning parameter registry (query-optimization plan QO-1): ONE typed,
 * versioned block of every perf-sensitive Query Studio knob, mirroring the
 * inline-completions overrides/profiles pattern. Precedence per knob:
 *
 *   run override ?? live override store ?? settings overrides object
 *     ?? named profile ?? dedicated setting ?? default
 *
 * The resolved snapshot (params + digest) is stamped into every run record
 * and the query.submit marker so events self-describe their parameters and
 * perftest spreads / replay experiments can vary and compare them.
 *
 * Rules (binding, EXECUTION_PLAN §1.11): no QO batch may introduce a new
 * hardcoded perf constant — register it here instead. Values are numbers,
 * booleans, and closed enum strings ONLY (snapshots ride diagnostics; no
 * user text can enter this file's value space).
 *
 * Webview-safe: no vscode/node imports; pure data + pure helpers.
 */

export type QueryTuningProfileId = "interactive" | "throughput" | "lowMemory" | "custom";

export type QueryTuningDiagnosticsLevel = "minimal" | "diagnostic" | "verbose" | "full";
export type QueryTuningGridWindowMode = "fixed" | "adaptive";
export type QueryTuningColumnProjectionMode = "off" | "wide" | "all";
export type QueryTuningDigestPolicy = "none" | "prefix" | "full";

export interface QueryTuningParams {
    // --- wire: ExecuteOptions sent to the SQL Data Plane backend ---
    /** Target rows per streamed page (backend clamps per its capabilities). */
    pageRows: number;
    /** Target encoded bytes per streamed page (honored once QO-3 lands service-side). */
    pageBytes: number;
    /** Cell byte cap before honest backend truncation. */
    maxCellBytes: number;
    /** Digest policy for truncated large cells (consumed by QO-4). */
    digestPolicy: QueryTuningDigestPolicy;

    // --- store: extension-host result storage (RowStore) ---
    maxRowsPerResultSet: number;
    storeMemoryBytes: number;
    storeSpillBytes: number;
    spillEnabled: boolean;
    /** Bounded async-spill queue cap — the STS2 ack backpressure point (QO-6). */
    maxPendingSpillBytes: number;
    /** Fraction of the page cache protected for viewport-fetched pages (QO-6). */
    protectedCacheRatio: number;
    /** Served-window cache entries above the page cache (QO-6). */
    windowCacheEntries: number;

    // --- notify: host→webview notification pacing ---
    /** 0 = per-page (current behavior); >0 = coalesce rows-appended pushes (QO-7). */
    rowsNotifyIntervalMs: number;
    /** 0 = immediate (current behavior); >0 = coalesce message pushes (QO-7). */
    messagesNotifyIntervalMs: number;
    statePushMinIntervalMs: number;

    // --- grid: webview result grid windowing/rendering ---
    gridWindowMode: QueryTuningGridWindowMode;
    gridWindowRows: number;
    /** Adaptive mode: viewport multiples to prefetch per direction (QO-7). */
    gridPrefetchFactor: number;
    gridMaxWindowRows: number;
    columnProjection: QueryTuningColumnProjectionMode;
    /** Extra columns fetched beyond the visible range when projecting (QO-7). */
    columnProjectionBuffer: number;
    autosizeSampleRows: number;
    /** Display-clamp for cell text entering the DOM. */
    displayCellClamp: number;
    /** Sort/filter enabled at or below this row count (mssql.resultsGrid.inMemoryDataProcessingThreshold). */
    inMemorySortFilterThreshold: number;
    /** Autosize ("size to fit") column-width ceiling in px — wider content ellipsizes. */
    gridMaxColumnWidthPx: number;

    // --- messages: messages pane ---
    messagesVirtualization: boolean;
    messagesWindowRows: number;

    // --- secondary: export / text view / cell documents ---
    exportChunkRows: number;
    /** Above this estimated output size, export streams to disk (QO-8). */
    exportStreamingThresholdBytes: number;
    /** Text view refuses/streams above this row count (QO-8). */
    textViewMaxRows: number;
    /** Rows sampled for text-view column widths (QO-8). */
    textViewSampleRows: number;
    /** Pretty-print/parse limit for opened cell documents. */
    cellDocumentFormatLimit: number;

    // --- diag: row-pipeline diagnostics granularity (QO-2) ---
    diagnosticsLevel: QueryTuningDiagnosticsLevel;

    // --- vector: Vector Workbench analysis budgets (VEC-4; host-authoritative,
    // the webview can never raise them — budgets ride resolved snapshots only) ---
    /** Rows scanned per analysis before honest partial (scan cap). */
    vectorScanRowLimit: number;
    /** Deterministic sample size for local analysis. */
    vectorSampleRows: number;
    /** Component budget (dims × rows) per analysis. */
    vectorComponentBudget: number;
    /** Packed Float32Array input ceiling per analysis. */
    vectorPackedInputBytes: number;
    /** Disclosed scan-byte budget on the sample descriptor (DA A6). */
    vectorScanByteBudget: number;
    /** Soft per-response RPC payload target. */
    vectorRpcSoftBytes: number;
    /** Hard per-response RPC payload cap. */
    vectorRpcHardBytes: number;
    /** Total per-analysis-session RPC payload cap. */
    vectorRpcSessionBytes: number;
    /** Hard wall-clock budget per full profile analysis. */
    vectorAnalysisTimeMsBudget: number;
    /** Concurrent analysis workers (global). */
    vectorMaxWorkers: number;
    /** Progress notification pacing ceiling. */
    vectorProgressMaxPerSecond: number;
}

/**
 * Override block: absent or null = defer to the next precedence layer.
 * `profileId` selects the named preset the remaining layers fall back to.
 */
export type QueryTuningOverrides = {
    [K in keyof QueryTuningParams]?: QueryTuningParams[K] | null;
} & { profileId?: QueryTuningProfileId | null };

/** Resolved per-run snapshot — stamped into run records and marker attrs. */
export interface QueryTuningSnapshot {
    profileId: QueryTuningProfileId;
    /** Stable short hash of the resolved params — equal params ⇒ equal digest across sessions. */
    digest: string;
    params: QueryTuningParams;
    /** Keys set by an override layer (run/store/settings-object), for cheap event attribution. */
    overriddenKeys: Array<keyof QueryTuningParams>;
}

type NumberSpec = { kind: "number"; min: number; max: number; integer: boolean };
type BooleanSpec = { kind: "boolean" };
type EnumSpec = { kind: "enum"; values: readonly string[] };
export type QueryTuningValueSpec = NumberSpec | BooleanSpec | EnumSpec;

const int = (min: number, max: number): NumberSpec => ({ kind: "number", min, max, integer: true });
const ratio: NumberSpec = { kind: "number", min: 0, max: 1, integer: false };
const bool: BooleanSpec = { kind: "boolean" };
const oneOf = (...values: string[]): EnumSpec => ({ kind: "enum", values });

const MiB = 1024 * 1024;

/**
 * Canonical key order + validation spec. The digest serializes params in THIS
 * order — append new keys at the group tails; never reorder existing keys
 * without recording a digest-epoch note in the QO journal.
 */
export const QUERY_TUNING_SPEC: Record<keyof QueryTuningParams, QueryTuningValueSpec> = {
    pageRows: int(1, 100_000),
    pageBytes: int(4096, 64 * MiB),
    maxCellBytes: int(256, 64 * MiB),
    digestPolicy: oneOf("none", "prefix", "full"),
    maxRowsPerResultSet: int(1, 1_000_000_000),
    storeMemoryBytes: int(1 * MiB, 4096 * MiB),
    storeSpillBytes: int(0, 65_536 * MiB),
    spillEnabled: bool,
    maxPendingSpillBytes: int(1 * MiB, 1024 * MiB),
    protectedCacheRatio: ratio,
    windowCacheEntries: int(0, 256),
    rowsNotifyIntervalMs: int(0, 1000),
    messagesNotifyIntervalMs: int(0, 1000),
    statePushMinIntervalMs: int(0, 1000),
    gridWindowMode: oneOf("fixed", "adaptive"),
    gridWindowRows: int(10, 1000),
    gridPrefetchFactor: int(1, 8),
    gridMaxWindowRows: int(50, 10_000),
    columnProjection: oneOf("off", "wide", "all"),
    columnProjectionBuffer: int(0, 100),
    autosizeSampleRows: int(1, 1000),
    displayCellClamp: int(64, 1 * MiB),
    inMemorySortFilterThreshold: int(0, 1_000_000),
    gridMaxColumnWidthPx: int(80, 4000),
    messagesVirtualization: bool,
    messagesWindowRows: int(50, 5000),
    exportChunkRows: int(64, 100_000),
    exportStreamingThresholdBytes: int(0, 1024 * MiB),
    textViewMaxRows: int(100, 10_000_000),
    textViewSampleRows: int(10, 100_000),
    cellDocumentFormatLimit: int(1024, 64 * MiB),
    diagnosticsLevel: oneOf("minimal", "diagnostic", "verbose", "full"),
    vectorScanRowLimit: int(100, 1_000_000),
    vectorSampleRows: int(100, 100_000),
    vectorComponentBudget: int(1_000_000, 256_000_000),
    vectorPackedInputBytes: int(1 * MiB, 512 * MiB),
    vectorScanByteBudget: int(1 * MiB, 1024 * MiB),
    vectorRpcSoftBytes: int(64 * 1024, 8 * MiB),
    vectorRpcHardBytes: int(128 * 1024, 16 * MiB),
    vectorRpcSessionBytes: int(1 * MiB, 256 * MiB),
    vectorAnalysisTimeMsBudget: int(1000, 300_000),
    vectorMaxWorkers: int(0, 4),
    vectorProgressMaxPerSecond: int(1, 30),
};

export const QUERY_TUNING_KEYS = Object.keys(QUERY_TUNING_SPEC) as Array<keyof QueryTuningParams>;

/**
 * Defaults = today's shipped behavior (behavior-preserving until a QO batch
 * deliberately re-tunes a default from perf-spread data, recorded in the
 * journal). Sources: Sts2Defaults, RowStore.DEFAULT_LIMITS, fluent grid
 * constants, results/export/text-view module constants.
 */
export const QUERY_TUNING_DEFAULTS: QueryTuningParams = {
    pageRows: 1000,
    pageBytes: 256 * 1024,
    maxCellBytes: 1 * MiB,
    digestPolicy: "prefix",
    maxRowsPerResultSet: 5_000_000,
    storeMemoryBytes: 64 * MiB,
    storeSpillBytes: 2048 * MiB,
    spillEnabled: true,
    maxPendingSpillBytes: 32 * MiB,
    protectedCacheRatio: 0.5,
    windowCacheEntries: 8,
    rowsNotifyIntervalMs: 0,
    // 50 ms message coalescing: measured on the 10k-PRINT shape (QO-7) —
    // per-message pushes flood the webview; batches preserve final counts
    // (completion always flushes).
    messagesNotifyIntervalMs: 50,
    statePushMinIntervalMs: 100,
    gridWindowMode: "fixed",
    gridWindowRows: 50,
    gridPrefetchFactor: 2,
    gridMaxWindowRows: 1000,
    columnProjection: "off",
    columnProjectionBuffer: 8,
    autosizeSampleRows: 50,
    displayCellClamp: 2048,
    inMemorySortFilterThreshold: 5000,
    // SSMS-density autosize ceiling (UX pass): long text ellipsizes at 260px
    // instead of one column eating the viewport.
    gridMaxColumnWidthPx: 260,
    messagesVirtualization: true,
    messagesWindowRows: 200,
    exportChunkRows: 2048,
    exportStreamingThresholdBytes: 8 * MiB,
    textViewMaxRows: 100_000,
    textViewSampleRows: 1000,
    cellDocumentFormatLimit: 256 * 1024,
    diagnosticsLevel: "minimal",
    // Vector Workbench budgets (VEC-4; impl-plan §19 registry values). The
    // lowMemory profile lowers the packed/scan ceilings below.
    vectorScanRowLimit: 25_000,
    vectorSampleRows: 5_000,
    vectorComponentBudget: 8_000_000,
    vectorPackedInputBytes: 64 * MiB,
    vectorScanByteBudget: 128 * MiB,
    vectorRpcSoftBytes: 1 * MiB,
    vectorRpcHardBytes: 2 * MiB,
    vectorRpcSessionBytes: 32 * MiB,
    vectorAnalysisTimeMsBudget: 30_000,
    vectorMaxWorkers: 2,
    vectorProgressMaxPerSecond: 4,
};

/** Named presets. `interactive` IS the defaults; `custom` is a sentinel (no preset values). */
export const QUERY_TUNING_PROFILES: Record<
    Exclude<QueryTuningProfileId, "custom">,
    Partial<QueryTuningParams>
> = {
    interactive: {},
    throughput: {
        pageRows: 4096,
        pageBytes: 1 * MiB,
        exportChunkRows: 8192,
        rowsNotifyIntervalMs: 100,
        messagesNotifyIntervalMs: 100,
    },
    lowMemory: {
        pageRows: 512,
        pageBytes: 128 * 1024,
        maxCellBytes: 256 * 1024,
        storeMemoryBytes: 16 * MiB,
        storeSpillBytes: 512 * MiB,
        displayCellClamp: 1024,
        vectorSampleRows: 2000,
        vectorComponentBudget: 2_000_000,
        vectorPackedInputBytes: 16 * MiB,
        vectorMaxWorkers: 1,
    },
};

export const QUERY_TUNING_PROFILE_IDS: readonly QueryTuningProfileId[] = [
    "interactive",
    "throughput",
    "lowMemory",
    "custom",
];

export function normalizeQueryTuningProfileId(value: unknown): QueryTuningProfileId | null {
    return QUERY_TUNING_PROFILE_IDS.includes(value as QueryTuningProfileId)
        ? (value as QueryTuningProfileId)
        : null;
}

/**
 * Validate + clamp one knob value against its spec. Returns undefined for
 * values of the wrong shape (they defer to the next layer, never coerce).
 */
export function normalizeQueryTuningValue(
    key: keyof QueryTuningParams,
    value: unknown,
): QueryTuningParams[keyof QueryTuningParams] | undefined {
    const spec = QUERY_TUNING_SPEC[key];
    switch (spec.kind) {
        case "number": {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return undefined;
            }
            const clamped = Math.min(spec.max, Math.max(spec.min, value));
            return spec.integer ? Math.floor(clamped) : clamped;
        }
        case "boolean":
            return typeof value === "boolean" ? value : undefined;
        case "enum":
            return typeof value === "string" && spec.values.includes(value)
                ? (value as QueryTuningParams[keyof QueryTuningParams])
                : undefined;
    }
}

/**
 * Normalize an untrusted override bag (settings object, replay config, store
 * update): unknown keys dropped, invalid values dropped, explicit null kept
 * (= defer). Pure; shared by the host store, the resolver, and replay.
 */
export function normalizeQueryTuningOverrides(value: unknown): QueryTuningOverrides {
    const normalized: QueryTuningOverrides = {};
    if (typeof value !== "object" || value === null) {
        return normalized;
    }
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "profileId")) {
        normalized.profileId =
            record.profileId === null ? null : normalizeQueryTuningProfileId(record.profileId);
    }
    for (const key of QUERY_TUNING_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            continue;
        }
        const raw = record[key];
        if (raw === null) {
            (normalized as Record<string, unknown>)[key] = null;
            continue;
        }
        const valid = normalizeQueryTuningValue(key, raw);
        if (valid !== undefined) {
            (normalized as Record<string, unknown>)[key] = valid;
        }
    }
    return normalized;
}

/** Present-and-non-null override value for a key, else undefined. */
export function queryTuningOverrideValue(
    overrides: QueryTuningOverrides | undefined,
    key: keyof QueryTuningParams,
): QueryTuningParams[keyof QueryTuningParams] | undefined {
    const value = overrides?.[key];
    return value === null || value === undefined ? undefined : value;
}

/** A snapshot's params as an override bag (faithful replay of a captured run). */
export function queryTuningParamsToOverrides(
    snapshot: Pick<QueryTuningSnapshot, "profileId" | "params">,
): QueryTuningOverrides {
    return { profileId: snapshot.profileId, ...snapshot.params };
}
