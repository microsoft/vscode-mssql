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
}

export interface GapRecord {
    kind: "gap";
    gapId: string;
    sessionId: string;
    fromSeq: number;
    throughSeq: number;
    droppedCount: number;
    reason: "subscriberOverflow" | "sinkOverflow" | "journalUnavailable";
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
    lane: DiagProcess | "userAction";
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

export interface PerfSummary {
    scenarios: string[];
    metrics: string[];
    samples: PerfMetricSample[];
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
export namespace DcExportRequest {
    export const type = new RequestType<
        { sourceId: string },
        { path?: string; events: number; redactions: number; error?: string },
        void
    >("dc/export");
}
export namespace DcLivePushNotification {
    export const type = new NotificationType<LiveTailPush>("dc/livePush");
}
export namespace DcCaptureChangedNotification {
    export const type = new NotificationType<{ mode: CaptureMode; expiresEpochMs?: number }>(
        "dc/captureChanged",
    );
}
