/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf Test History contracts (extension host <-> Debug Console webview).
 *
 * Design rules (spec: MSSQL_Debug_Console_Perf_Test_History_View_Spec.md):
 *  - metadata-first: run/scenario rows come from an incremental index, never
 *    from parsing every artifact on page open;
 *  - heavy artifacts (markers, SQL activity, dumps) load lazily per tab;
 *  - official vs diagnostic stays visible on every metric;
 *  - nothing is fabricated — missing data is missing, with a reason.
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";
import { SqlActivityRow, WaterfallModel } from "./debugConsole";

// --- sources -----------------------------------------------------------------

export type PerfSourceKind = "directory" | "sqlite" | "bundle";

export type PerfSourceStatus =
    | "indexed"
    | "scanning"
    | "partial"
    | "stale"
    | "error"
    | "empty"
    | "unsupported";

export interface PerfHistorySource {
    id: string;
    kind: PerfSourceKind;
    label: string;
    path: string;
    status: PerfSourceStatus;
    statusMessage?: string;
    readOnly: boolean;
    isDefault?: boolean;
    runCount: number;
    scenarioCount: number;
    lastIndexedUtc?: string;
    /** How long the last (re)index took — scale transparency, not decoration. */
    indexMs?: number;
}

// --- runs ---------------------------------------------------------------------

/** Honest verdict derived from recorded statuses (no invented regressions). */
export type RunVerdict = "ok" | "warning" | "failed" | "invalid" | "unknown";

export interface PerfRunRow {
    runId: string;
    sourceId: string;
    createdUtc: string;
    /** Raw run status from summary.json (passed|failed|invalid|unknown). */
    status: string;
    verdict: RunVerdict;
    label?: string;
    passType?: string;
    environmentHash?: string;
    commit?: string;
    dirty?: boolean;
    scenarioTotal: number;
    scenarioPassed: number;
    repTotal: number;
    failedReps: number;
    invalidReps: number;
    /** Run-wide official scenario.wallclock aggregates (passed, non-warmup reps). */
    wallP50Ms?: number;
    wallP95Ms?: number;
    artifactKinds: string[];
    /** Self-test provenance (mode only; label is server/database, no secrets). */
    connectionMode?: string;
}

export interface PerfRunsQuery {
    sourceId: string;
    offset?: number;
    limit?: number;
    sortBy?: "createdUtc" | "runId" | "wallP50Ms" | "verdict";
    sortDir?: "asc" | "desc";
    /** Searches runId, label, commit, passType. */
    text?: string;
    verdicts?: RunVerdict[];
    sinceUtc?: string;
    passTypes?: string[];
}

export interface PagedRuns {
    rows: PerfRunRow[];
    total: number;
    /** Total before filters — for "x of y" honesty. */
    totalInSource: number;
}

// --- scenarios ------------------------------------------------------------------

export type ScenarioGroupBy = "scenario" | "suite" | "verdict" | "run";

export interface PerfScenarioRow {
    /** Group key (scenarioId in scenario mode, group value otherwise). */
    key: string;
    scenarioId?: string;
    suite?: string;
    runIds: string[];
    verdict: RunVerdict;
    validReps: number;
    totalReps: number;
    /** Aggregates for `metricName` over valid reps in the selected runs. */
    metricName: string;
    p50Ms?: number;
    p95Ms?: number;
    baselineP50Ms?: number;
    deltaPct?: number;
    artifactKinds: string[];
    /** Fewer than 3 valid reps — aggregates are advisory. */
    lowConfidence?: boolean;
    skippedReason?: string;
    /** Group rows: the scenario ids folded into this group (drill-down). */
    memberScenarioIds?: string[];
}

export interface PerfScenariosQuery {
    sourceId: string;
    /** Selected run scope; empty ⇒ latest run. */
    runIds: string[];
    /** Baseline for deltas; default = closest earlier run with the scenario. */
    baselineRunId?: string;
    metric?: string;
    groupBy?: ScenarioGroupBy;
    text?: string;
    verdicts?: RunVerdict[];
    /** Only scenarios that have this artifact kind. */
    artifactKind?: string;
    suite?: string;
}

// --- series + details -------------------------------------------------------------

export interface PerfMetricSeriesPoint {
    runId: string;
    createdUtc: string;
    p50: number;
    p95: number;
    n: number;
}

export interface PerfMetricSeriesQuery {
    sourceId: string;
    scenarioId: string;
    metric: string;
    lastN?: number;
}

export interface PerfRepRow {
    repId: number;
    status: string;
    warmup: boolean;
    metrics: Array<{
        name: string;
        value: number;
        unit: string;
        official: boolean;
        eligibility?: PerfMetricEligibility;
    }>;
    failureReason?: string;
    hasMarkers: boolean;
}

/** Structured trust labels (Shared Observability Contract), pass-through from result.json. */
export interface PerfMetricEligibility {
    measurementEligible: boolean;
    ciGatingEligible: boolean;
    exploratory: boolean;
    diagnosticOnly: boolean;
    reason: string;
}

export interface PerfSubmetricRow {
    name: string;
    unit: string;
    official: boolean;
    eligibility?: PerfMetricEligibility;
    p50?: number;
    baselineP50?: number;
    deltaPct?: number;
    n: number;
}

export interface PerfValidationRow {
    name: string;
    status: string;
    message?: string;
}

export interface PerfArtifactRef {
    kind: string;
    path: string;
    repId?: number;
    sizeBytes?: number;
}

export interface PerfScenarioDetails {
    runId: string;
    scenarioId: string;
    reps: PerfRepRow[];
    submetrics: PerfSubmetricRow[];
    validations: PerfValidationRow[];
    artifacts: PerfArtifactRef[];
    skippedReason?: string;
}

export interface PerfScenarioDetailsQuery {
    sourceId: string;
    runId: string;
    scenarioId: string;
    baselineRunId?: string;
}

// --- Runs Summary tab ---------------------------------------------------------------

export interface PerfNeedsAttentionRow {
    runId: string;
    scenarioId: string;
    kind: "failed" | "invalid" | "lowN" | "slower";
    detail: string;
    createdUtc: string;
}

export interface PerfRunsSummary {
    source: PerfHistorySource;
    kpis: {
        runs: number;
        scenarios: number;
        latestRunId?: string;
        latestVerdict: RunVerdict;
        latestCreatedUtc?: string;
        medianWallMs?: number;
        deltaVsPrevPct?: number;
        p95WallMs?: number;
        failedReps: number;
        invalidReps: number;
        sourceCount: number;
    };
    /** Most recent run whose wallclock got slower vs the prior run (>10%). */
    latestSlower?: {
        runId: string;
        scenarioId: string;
        deltaPct: number;
        createdUtc: string;
    };
    /** Run-wide wallclock medians, oldest → newest (capped). */
    trend: PerfMetricSeriesPoint[];
    suiteHealth: Array<{ suite: string; ok: number; total: number }>;
    needsAttention: PerfNeedsAttentionRow[];
}

// --- artifact payloads ------------------------------------------------------------

export interface PerfWaterfallQuery {
    sourceId: string;
    runId: string;
    scenarioId: string;
    repId: number;
}

export interface PerfDumpQuery {
    sourceId: string;
    runId: string;
    scenarioId?: string;
    repId?: number;
    /** Which file: summary | result | markers-head. */
    file: "summary" | "result" | "markersHead";
}

export interface PerfDumpResult {
    /** Pretty-printed JSON (or JSONL head), size-capped server-side. */
    text: string;
    truncated: boolean;
    path: string;
}

// --- rich diagnostics (opt-in COLLECT_ALL_THE_DATA runs) -----------------------

export interface PerfRichSnapshot {
    epochMs: number;
    /** heapUsedMB, rssMB, eventLoopP95Ms, cpuUserMs, … (diagnostic-only). */
    metrics: Record<string, number>;
}

export interface PerfRichSpanDelta {
    type: string;
    durationMs?: number;
    heapDeltaKB?: number;
}

export interface PerfRichDiagnostics {
    /** system.rich.snapshot counter series for the rep. */
    snapshots: PerfRichSnapshot[];
    /** Spans that carried rich per-span deltas, worst heap delta first. */
    spanDeltas: PerfRichSpanDelta[];
    /** false ⇒ the run was not collected with rich diagnostics. */
    found: boolean;
}

// --- indexing progress ---------------------------------------------------------------

export interface PerfIndexProgress {
    sourceId: string;
    state: "scanning" | "done" | "error";
    scanned: number;
    total: number;
    message?: string;
}

// --- RPC ------------------------------------------------------------------------------

export namespace PhListSourcesRequest {
    export const type = new RequestType<void, PerfHistorySource[], void>("ph/listSources");
}
export namespace PhAddSourceRequest {
    /** Opens the picker for the kind; resolves with the updated source list. */
    export const type = new RequestType<
        { kind: PerfSourceKind },
        { sources: PerfHistorySource[]; addedId?: string; error?: string },
        void
    >("ph/addSource");
}
export namespace PhRemoveSourceRequest {
    export const type = new RequestType<{ sourceId: string }, PerfHistorySource[], void>(
        "ph/removeSource",
    );
}
export namespace PhRescanRequest {
    export const type = new RequestType<{ sourceId: string }, PerfHistorySource, void>("ph/rescan");
}
export namespace PhGetSummaryRequest {
    export const type = new RequestType<{ sourceId: string }, PerfRunsSummary, void>(
        "ph/getSummary",
    );
}
export namespace PhQueryRunsRequest {
    export const type = new RequestType<PerfRunsQuery, PagedRuns, void>("ph/queryRuns");
}
export namespace PhQueryScenariosRequest {
    export const type = new RequestType<PerfScenariosQuery, PerfScenarioRow[], void>(
        "ph/queryScenarios",
    );
}
export namespace PhMetricSeriesRequest {
    export const type = new RequestType<PerfMetricSeriesQuery, PerfMetricSeriesPoint[], void>(
        "ph/metricSeries",
    );
}
export namespace PhScenarioDetailsRequest {
    export const type = new RequestType<PerfScenarioDetailsQuery, PerfScenarioDetails, void>(
        "ph/scenarioDetails",
    );
}
export namespace PhGetWaterfallRequest {
    export const type = new RequestType<PerfWaterfallQuery, WaterfallModel | undefined, void>(
        "ph/getWaterfall",
    );
}
export namespace PhGetSqlActivityRequest {
    export const type = new RequestType<PerfWaterfallQuery, SqlActivityRow[], void>(
        "ph/getSqlActivity",
    );
}
export namespace PhGetDumpRequest {
    export const type = new RequestType<PerfDumpQuery, PerfDumpResult, void>("ph/getDump");
}
export namespace PhGetRichDiagnosticsRequest {
    export const type = new RequestType<PerfWaterfallQuery, PerfRichDiagnostics, void>(
        "ph/getRichDiagnostics",
    );
}
export namespace PhDeleteRunRequest {
    /** Deletes the run DIRECTORY from disk (writable directory sources only). */
    export const type = new RequestType<
        { sourceId: string; runId: string },
        { ok: boolean; error?: string },
        void
    >("ph/deleteRun");
}
export namespace PhIndexProgressNotification {
    export const type = new NotificationType<PerfIndexProgress>("ph/indexProgress");
}
