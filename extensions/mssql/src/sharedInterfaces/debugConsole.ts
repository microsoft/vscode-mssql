/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared contracts for the MSSQL diagnostics substrate and the Debug Console
 * webview (design: debug-docs/MSSQL_Debug_Console_Technical_Design.md).
 * Everything here crosses the extension-host <-> webview boundary, so it must
 * stay JSON-serializable and free of runtime imports.
 */

export const DIAG_SCHEMA_VERSION = "mssql.diag.event/1";

export type DiagProcess =
    | "extensionHost"
    | "webview"
    | "renderer"
    | "sqlToolsService"
    | "sqlServer"
    | "harness"
    | "system";

export type DiagKind =
    | "event"
    | "span"
    | "metric"
    | "request"
    | "response"
    | "sqlActivity"
    | "renderPhase"
    | "gap"
    | "state";

export type DiagStatus = "ok" | "info" | "warning" | "error" | "blocked" | "partial";

export type DiagTimingClass =
    | "officialSameProcess"
    | "productTimer"
    | "epochAlignedDiagnostic"
    | "collectorDiagnostic"
    | "inferred";

export type DataClassification =
    | "public"
    | "system.metadata"
    | "diagnostic.metadata"
    | "source.path"
    | "server.name"
    | "database.name"
    | "schema.name"
    | "object.name"
    | "sql.text"
    | "sql.digest"
    | "row.data"
    | "result.shape"
    | "secret"
    | "connection.string"
    | "token"
    | "user.text"
    | "model.prompt"
    | "model.response"
    | "unknown";

export type RedactionHandling =
    | "plain"
    | "redacted"
    | "digest"
    | "tokenized"
    | "truncated"
    | "omitted";

/**
 * A payload field after capture-policy application. Raw sensitive values are
 * redacted BEFORE the envelope is constructed — a redacted value never exists
 * in a sink, the store, or the webview DOM.
 */
export interface ClassifiedValue {
    /** Post-redaction display value (absent when handling is omitted/redacted). */
    v?: string | number | boolean | null;
    cls: DataClassification;
    handling: RedactionHandling;
    /** Stable digest for equality/grouping when handling is digest. */
    digest?: string;
    /** Original length for truncated values. */
    len?: number;
}

export interface DiagClassificationSummary {
    max: DataClassification;
    redactedFields: number;
    policyId: string;
}

export interface DiagEvent {
    schemaVersion: typeof DIAG_SCHEMA_VERSION;
    eventId: string;
    sessionId: string;
    seq: number;
    /** Epoch milliseconds (extension-host clock unless process says otherwise). */
    epochMs: number;
    /** Same-process monotonic nanoseconds when available. */
    monotonicNs?: string;
    process: DiagProcess;
    pid?: number;
    feature: string;
    kind: DiagKind;
    /** Semantic type, e.g. "command.mssql.runQuery.begin", "rpc.query/executeString". */
    type: string;
    status: DiagStatus;
    traceId?: string;
    causeEventId?: string;
    /** Entity anchor, e.g. { kind: "document", id: "uri:sha256:..." }. */
    entity?: { kind: string; id: string };
    durationMs?: number;
    timingClass?: DiagTimingClass;
    payload?: Record<string, ClassifiedValue>;
    cls: DiagClassificationSummary;
    tags?: string[];
    /**
     * Rich diagnostics enrichment (opt-in COLLECT_ALL_THE_DATA mode): cheap
     * context metrics captured at emission. Never official-eligible; absent
     * when rich collection is off (zero cost).
     */
    perf?: {
        captureLevel: "rich";
        officialEligible: false;
        metrics: Record<string, number>;
        collectionCost: "free" | "low";
    };
}

export interface GapRecord {
    kind: "gap";
    gapId: string;
    sessionId: string;
    fromSeq: number;
    throughSeq: number;
    droppedCount: number;
    reason: "subscriberOverflow" | "sinkOverflow" | "journalUnavailable";
    /** First seq delivered AFTER the gap — the exact resync point. */
    firstAvailableSeq?: number;
    backfillStatus: "notStarted" | "running" | "succeeded" | "partial" | "failed";
    epochMs: number;
}

// ---------------------------------------------------------------------------
// Capture policy
// ---------------------------------------------------------------------------

export type CaptureMode = "off" | "redacted" | "digest" | "full";

export interface CapturePolicy {
    policyId: string;
    mode: CaptureMode;
    allowSqlText: boolean;
    allowRowData: boolean;
    allowConnectionDetails: boolean;
    /** Secrets are never persisted; the type forbids it. */
    allowSecrets: false;
    /** Elevated policies auto-revert at this time. */
    expiresEpochMs?: number;
    reason?: string;
}

// ---------------------------------------------------------------------------
// Sources and sessions
// ---------------------------------------------------------------------------

export type DebugSourceKind = "liveSession" | "localSession" | "perfRun" | "bundle";

export type DebugSourceCapability =
    | "liveTail"
    | "historyQuery"
    | "waterfall"
    | "sqlActivity"
    | "perfMetrics"
    | "exportable"
    | "backfillableGaps";

export interface DebugSource {
    id: string;
    kind: DebugSourceKind;
    label: string;
    readonly: boolean;
    createdUtc?: string;
    eventCount?: number;
    unresolvedGapCount?: number;
    captureMode?: CaptureMode;
    capabilities: DebugSourceCapability[];
    provenance: ProvenanceSummary;
}

export interface ProvenanceSummary {
    extensionVersion?: string;
    commit?: string;
    dirty?: boolean;
    environmentHash?: string;
    vscodeVersion?: string;
    stsVersion?: string;
    machineLabel?: string;
}

export interface SessionManifest {
    schemaVersion: "mssql.diag.sessionManifest/1";
    sessionId: string;
    createdUtc: string;
    updatedUtc: string;
    source: "live" | "perfRun" | "bundle";
    captureMode: CaptureMode;
    policyId: string;
    eventCount: number;
    gapCount: number;
    segments: Array<{ file: string; firstSeq: number; lastSeq: number; events: number }>;
    /** Total bytes across segments (updated on flush). */
    sizeBytes?: number;
    /** Exact seq ranges lost to store-buffer overflow. */
    droppedRanges?: Array<{ fromSeq: number; throughSeq: number }>;
    provenance: ProvenanceSummary;
    status: "active" | "closed" | "partial";
}

// ---------------------------------------------------------------------------
// Store query API
// ---------------------------------------------------------------------------

export interface EventQuery {
    sourceId: string;
    /** Filters — all optional, ANDed. */
    processes?: DiagProcess[];
    features?: string[];
    kinds?: DiagKind[];
    statuses?: DiagStatus[];
    traceId?: string;
    text?: string;
    fromSeq?: number;
    /** Page size; server clamps. */
    limit?: number;
    /** When set, return rows ending at this seq going backwards (tail pages). */
    beforeSeq?: number;
    /**
     * Debug Console's own RPC spans (tag "viewerInternal") are excluded by
     * default so viewing a trace never pollutes it; set true to include them
     * when debugging the console itself.
     */
    includeViewerInternal?: boolean;
    /** Duration filters (events without durationMs never match when set). */
    minDurationMs?: number;
    maxDurationMs?: number;
}

export interface EventQueryResult {
    rows: Array<DiagEvent | GapRecord>;
    totalMatching: number;
    totalInSource: number;
}

export interface CauseTreeNode {
    event: DiagEvent;
    children: CauseTreeNode[];
}

export interface WaterfallActivity {
    id: string;
    lane: DiagProcess | "userAction" | "driver";
    label: string;
    startEpochMs: number;
    endEpochMs: number;
    durationMs: number;
    timingClass: DiagTimingClass;
    status: DiagStatus;
    traceId?: string;
    causeEventId?: string;
    sourceEventIds: string[];
    detail?: string;
}

export interface WaterfallModel {
    traceId: string;
    label: string;
    startEpochMs: number;
    endEpochMs: number;
    activities: WaterfallActivity[];
    /** Ordered critical-path step summaries; empty when not computable. */
    criticalPath: Array<{ label: string; durationMs: number; note?: string }>;
    calibrationNote?: string;
}

/** A correlation root shown in Overview "Recent user actions". */
export interface UserActionSummary {
    traceId: string;
    label: string;
    feature: string;
    startEpochMs: number;
    durationMs?: number;
    status: DiagStatus;
    sqlCommands: number;
    renderMs?: number;
    gaps: number;
    eventCount: number;
}

export interface SourceKpis {
    events: number;
    errors: number;
    warnings: number;
    gaps: number;
    slowestActionMs?: number;
    slowestActionLabel?: string;
    sqlCommands: number;
    captureMode: CaptureMode;
    redactedFields: number;
}

export interface AnomalySummary {
    id: string;
    severity: "info" | "warning" | "error";
    title: string;
    detail: string;
    traceId?: string;
    page: string;
}

// ---------------------------------------------------------------------------
// Webview protocol (requests are vscode-webview RPC; live events are pushes)
// ---------------------------------------------------------------------------

export interface DebugConsoleState {
    /** Initial snapshot pushed to the webview. */
    sources: DebugSource[];
    activeSourceId: string;
    captureMode: CaptureMode;
    captureExpiresEpochMs?: number;
    provenance: ProvenanceSummary;
    fixtureMode: boolean;
}

export interface LiveTailPushEvent {
    kind: "events";
    events: DiagEvent[];
    lastSeq: number;
}

export interface LiveTailPushGap {
    kind: "gap";
    gap: GapRecord;
}

export type LiveTailPush = LiveTailPushEvent | LiveTailPushGap;

// Perf & Sessions -----------------------------------------------------------

export interface PerfMetricSample {
    runId: string;
    createdUtc: string;
    scenarioId: string;
    metricName: string;
    unit: string;
    value: number;
    official: boolean;
    tag?: string;
    commit?: string;
}

export interface PerfRunInfo {
    runId: string;
    createdUtc: string;
    status: string;
    passType?: string;
    environmentHash?: string;
    scenarioCount: number;
}

export interface PerfSummary {
    scenarios: string[];
    metrics: string[];
    samples: PerfMetricSample[];
    runs: PerfRunInfo[];
}

// ---------------------------------------------------------------------------
// Self-test: run perftest scenarios in-process against the LIVE extension host
// ---------------------------------------------------------------------------

export interface SelfTestScenarioInfo {
    id: string;
    title: string;
    description: string;
    tags: string[];
    /** Requires a live SQL connection (offered but blocked when none resolves). */
    needsSql: boolean;
    /** Cannot run honestly in-process (e.g. cold activation) — CLI harness only. */
    cliOnly?: boolean;
    estMs: number;
}

export type SelfTestConnectionMode = "active" | "saved" | "env" | "none";

/** One selectable way to provide SQL connectivity to a self-test run. */
export interface SelfTestConnectionOption {
    id: string;
    mode: SelfTestConnectionMode;
    /** Redacted label — server/database only, never credentials. */
    label: string;
    detail?: string;
    available: boolean;
    reason?: string;
}

export interface SelfTestCatalog {
    scenarios: SelfTestScenarioInfo[];
    /** All resolvable connection options (active editors, saved profiles, env var, none). */
    connections: SelfTestConnectionOption[];
    perfRunsRoot: string;
    running: boolean;
    /** Set when the perftest in-process runner could not be loaded. */
    unavailableReason?: string;
}

export interface SelfTestRunRequest {
    scenarioIds: string[];
    repetitions: number;
    warmupRepetitions: number;
    /** Opt-in richer capture (full) for the run window; auto-reverts. */
    elevateCapture?: boolean;
    /** Opt-in rich diagnostics collection for the run window; auto-reverts. */
    collectRich?: boolean;
    /** Selected connection option; omitted ⇒ "none" (SQL scenarios skip). */
    connection?: {
        mode: SelfTestConnectionMode;
        optionId?: string;
        /** env mode: variable holding a SQL connection string (value never persisted). */
        envVarName?: string;
    };
}

export interface SelfTestRunStarted {
    accepted: boolean;
    runId: string;
    /** Redacted description of the connection the run will use (or why none). */
    connectionLabel?: string;
    reason?: string;
}

/** A flattened, serializable projection of the runner's event stream. */
export interface SelfTestProgress {
    runId: string;
    phase:
        | "runStart"
        | "scenarioStart"
        | "scenarioSkipped"
        | "repStart"
        | "repEnd"
        | "scenarioEnd"
        | "log"
        | "runEnd"
        | "error";
    scenarioId?: string;
    title?: string;
    index?: number;
    total?: number;
    scenarioCount?: number;
    totalReps?: number;
    repId?: number;
    warmup?: boolean;
    status?: string;
    durationMs?: number;
    metrics?: Array<{ name: string; value: number; official: boolean }>;
    reason?: string;
    message?: string;
    passed?: number;
    failed?: number;
    // runEnd summary
    runStatus?: string;
    perfRunsRoot?: string;
    skipped?: number;
    /** Console source registered for this run's events (drill into trace/waterfall). */
    attachedSourceId?: string;
}

export interface SqlActivityRow {
    epochMs: number;
    eventName: string;
    durationMs?: number;
    cpuMs?: number;
    logicalReads?: number;
    rowCount?: number;
    text: ClassifiedValue;
    correlation?: string;
    sourceEventId?: string;
}

// ---------------------------------------------------------------------------
// RPC types (extension host <-> Debug Console webview)
// ---------------------------------------------------------------------------

import { NotificationType, RequestType } from "vscode-jsonrpc";

export interface SourceOverview {
    kpis: SourceKpis;
    actions: UserActionSummary[];
    anomalies: AnomalySummary[];
}

export namespace DcListSourcesRequest {
    export const type = new RequestType<void, DebugSource[], void>("dc/listSources");
}
export namespace DcQueryEventsRequest {
    export const type = new RequestType<EventQuery, EventQueryResult, void>("dc/queryEvents");
}
export namespace DcGetOverviewRequest {
    export const type = new RequestType<{ sourceId: string }, SourceOverview, void>(
        "dc/getOverview",
    );
}
export namespace DcGetCauseTreeRequest {
    export const type = new RequestType<
        { sourceId: string; eventId: string },
        CauseTreeNode | undefined,
        void
    >("dc/getCauseTree");
}
export namespace DcGetWaterfallRequest {
    export const type = new RequestType<
        { sourceId: string; traceId: string },
        WaterfallModel | undefined,
        void
    >("dc/getWaterfall");
}
export namespace DcListTracesRequest {
    export const type = new RequestType<{ sourceId: string }, UserActionSummary[], void>(
        "dc/listTraces",
    );
}
export namespace DcGetSqlActivityRequest {
    export const type = new RequestType<{ sourceId: string }, SqlActivityRow[], void>(
        "dc/getSqlActivity",
    );
}
export namespace DcSubscribeLiveRequest {
    export const type = new RequestType<
        void,
        { snapshot: EventQueryResult; lastSeq: number },
        void
    >("dc/subscribeLive");
}
export namespace DcUnsubscribeLiveRequest {
    export const type = new RequestType<void, void, void>("dc/unsubscribeLive");
}
export namespace DcSetCaptureModeRequest {
    export const type = new RequestType<
        { mode: CaptureMode; reason?: string; durationMinutes?: number },
        { mode: CaptureMode; expiresEpochMs?: number },
        void
    >("dc/setCaptureMode");
}
export namespace DcImportPerfRunRequest {
    export const type = new RequestType<void, DebugSource[] | undefined, void>("dc/importPerfRun");
}
export namespace DcGetPerfSummaryRequest {
    export const type = new RequestType<{ perfRunsRoot?: string }, PerfSummary, void>(
        "dc/getPerfSummary",
    );
}
// --- Evidence durability (Chunk 2) -----------------------------------------

/** Backfill a live-tail gap from the session store journal. */
export interface GapBackfillResult {
    ok: boolean;
    /** Recovered events (seq-ordered) when ok. */
    events?: DiagEvent[];
    /** Honest failure reason: store disabled, range evicted, read error. */
    reason?: string;
    status: GapRecord["backfillStatus"];
}
export namespace DcBackfillGapRequest {
    export const type = new RequestType<
        { gapId: string; fromSeq: number; throughSeq: number },
        GapBackfillResult,
        void
    >("dc/backfillGap");
}

/** One sink health row: a sink may degrade but never silently. */
export interface SinkHealth {
    id: string;
    healthy: boolean;
    detail: string;
    counters: Record<string, number>;
}
export interface StoreHealth {
    enabled: boolean;
    sessions: number;
    totalBytes: number;
    /** Integrity findings across persisted sessions (empty = clean). */
    issues: string[];
}
export interface DiagHealthSnapshot {
    sinks: SinkHealth[];
    store: StoreHealth;
}
export namespace DcGetHealthRequest {
    export const type = new RequestType<void, DiagHealthSnapshot, void>("dc/getHealth");
}

/** Trace quality (Trace Identity V1 lint) — fog made visible. */
export interface TraceQualityReport {
    totalEvents: number;
    orphanCount: number;
    orphanRatio: number;
    unmatchedPairs: Array<{ name: string; begins: number; ends: number }>;
    longLivedRoots: Array<{ traceId: string; durationMs: number; eventCount: number }>;
    epochAlignedCount: number;
    outsideScenarioWindow: number;
    score: "good" | "fair" | "poor";
    notes: string[];
}
export namespace DcGetTraceQualityRequest {
    export const type = new RequestType<
        { sourceId: string; traceId?: string },
        TraceQualityReport,
        void
    >("dc/getTraceQuality");
}

export namespace DcExportRequest {
    export const type = new RequestType<
        { sourceId: string },
        { path?: string; events: number; redactions: number; error?: string },
        void
    >("dc/export");
}
// Central observability upload (central design §8.3, addendum C-11) --------

/** Serializable resolution of the central upload target (never a connstring). */
export interface CentralTargetInfo {
    enabled: boolean;
    configured: boolean;
    profileLabel?: string;
    database?: string;
    policyId: string;
    error?: string;
}

/** Serializable receipt subset for the webview (digest prefixes only). */
export interface CentralReceiptInfo {
    uploadBatchId: number;
    outcome: string;
    naturalKey: string;
    policyId: string;
    totalRows: number;
    projectionDigest: string;
    committedAtUtc?: string;
}

export interface CentralPreviewInfo {
    sourceKind: string;
    naturalKey: string;
    policyId: string;
    tables: Array<{ name: string; rows: number; bytesEstimate: number }>;
    dropped: Array<{ field: string; cls: string; count: number }>;
    digested: Array<{ field: string; cls: string; count: number }>;
    refused: Array<{ field: string; cls: string; reason: string }>;
    warnings: string[];
    sourceSummary: {
        files: number;
        bytes: number;
        events?: number;
        gaps?: number;
        metrics?: number;
    };
    projectionDigest: string;
}

export namespace DcCentralPreviewRequest {
    export const type = new RequestType<
        { sourceId: string; policyId?: string },
        { target: CentralTargetInfo; preview?: CentralPreviewInfo; error?: string },
        void
    >("dc/centralPreview");
}

export namespace DcCentralUploadRequest {
    export const type = new RequestType<
        { sourceId: string; policyId?: string },
        {
            outcome: string;
            receipt?: CentralReceiptInfo;
            reasonCode?: string;
            error?: string;
        },
        void
    >("dc/centralUpload");
}

export namespace DcCentralUploadProgressNotification {
    export const type = new NotificationType<{ sourceId: string; done: number; total: number }>(
        "dc/centralUploadProgress",
    );
}

// History (cross-session) ---------------------------------------------------

export interface HistorySessionRow {
    sourceId: string;
    label: string;
    createdUtc: string;
    live: boolean;
    events: number;
    errors: number;
    gaps: number;
    captureMode: CaptureMode;
    actionCount: number;
}

export interface HistoryActionTrend {
    label: string;
    feature: string;
    points: Array<{
        sourceId: string;
        sessionLabel: string;
        createdUtc: string;
        medianMs: number;
        count: number;
        errors: number;
    }>;
}

export interface HistorySummary {
    sessions: HistorySessionRow[];
    trends: HistoryActionTrend[];
    totalEvents: number;
    totalActions: number;
}

export namespace DcGetHistoryRequest {
    export const type = new RequestType<void, HistorySummary, void>("dc/getHistory");
}

export namespace DcListSelfTestScenariosRequest {
    export const type = new RequestType<void, SelfTestCatalog, void>("dc/listSelfTestScenarios");
}
export namespace DcRunSelfTestRequest {
    export const type = new RequestType<SelfTestRunRequest, SelfTestRunStarted, void>(
        "dc/runSelfTest",
    );
}
export namespace DcCancelSelfTestRequest {
    export const type = new RequestType<void, { cancelled: boolean }, void>("dc/cancelSelfTest");
}
export namespace DcSelfTestProgressNotification {
    export const type = new NotificationType<SelfTestProgress>("dc/selfTestProgress");
}

export namespace DcLivePushNotification {
    export const type = new NotificationType<LiveTailPush>("dc/livePush");
}
export namespace DcCaptureChangedNotification {
    export const type = new NotificationType<{ mode: CaptureMode; expiresEpochMs?: number }>(
        "dc/captureChanged",
    );
}
