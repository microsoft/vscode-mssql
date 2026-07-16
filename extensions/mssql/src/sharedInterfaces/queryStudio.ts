/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio versioned RPC contracts (Qs*). Debug Console webview pattern:
 * coarse state pushes + hot-path RPCs; row data NEVER rides coarse state
 * (QsRowsAppended carries counts only — addendum §3.6; rows cross only via
 * QsGetRows in the compact window shape, Appendix A).
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";
import { ExecutionPlanState } from "./executionPlan";
import type { QueryStudioGridCopyRange } from "./queryStudioGridCopy";

export const QS_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Text synchronization (doc 04 §8) — the performance-critical subsystem
// ---------------------------------------------------------------------------

/** One text edit in offset space (Monaco/TextDocument agnostic). */
export interface QsTextEdit {
    /** 0-based UTF-16 start offset in the pre-edit text. */
    start: number;
    /** 0-based UTF-16 end offset (exclusive) in the pre-edit text. */
    end: number;
    text: string;
}

export interface QsSyncInit {
    text: string;
    hostVersion: number;
    textHash: string;
    eol: "\n" | "\r\n";
}

export interface QsSyncRemote {
    fromHostVersion: number;
    toHostVersion: number;
    edits: QsTextEdit[];
    textHash: string;
    reason: "hostEdit" | "echo" | "external" | "undo" | "redo" | "save";
    /** Present on echo so the webview can drop its own reflected group. */
    echoOfEditGroupId?: string;
}

export interface QsSyncResync {
    text: string;
    hostVersion: number;
    textHash: string;
    reason: string;
    eol?: "\n" | "\r\n";
}

export interface QsSyncEdits {
    baseHostVersion: number;
    editGroupId: string;
    edits: QsTextEdit[];
    selectionBefore?: QsSelection;
    selectionAfter?: QsSelection;
    textHashAfter: string;
}

export interface QsSelection {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export interface QsSyncEditsResult {
    applied: boolean;
    hostVersion: number;
    /** Set when the host detected divergence and a resync will follow. */
    resyncPending?: boolean;
}

// ---------------------------------------------------------------------------
// Coarse state (≤10/s)
// ---------------------------------------------------------------------------

export type QsConnectionStateKind =
    | "disconnected"
    | "connecting"
    | "connected"
    | "executing"
    | "disconnecting"
    | "lost";

export interface QsConnectionState {
    kind: QsConnectionStateKind;
    serverDisplayName?: string;
    serverVersion?: string;
    engineEdition?: number;
    loginName?: string;
    spid?: number;
    database?: string;
    encrypted?: boolean;
    accentColor?: string;
    /** Production safety: readable text color computed for accentColor. */
    accentTextColor?: string;
    /** True when the profile's server group is marked production. */
    production?: boolean;
    backend?: string;
    lostReason?: string;
    /** Open @@TRANCOUNT on the session when > 0 (post-run probe, SSMS parity). */
    openTransactions?: number;
}

export type QsExecutionStateKind =
    | "idle"
    | "executing"
    | "cancelRequested"
    | "succeeded"
    | "completedWithErrors"
    | "failed"
    | "canceled"
    | "connectionLost";

export interface QsExecutionState {
    kind: QsExecutionStateKind;
    startedEpochMs?: number;
    elapsedMs?: number;
    batchCount?: number;
    currentBatch?: number;
}

export interface QsResultSetSummary {
    resultSetId: string;
    batchOrdinal: number;
    columnNames: string[];
    columns?: QsResultColumn[];
    rowCount: number;
    /** Logical compact-page bytes accepted for this result set (not JS heap). */
    approxBytes?: number;
    complete: boolean;
    truncatedReason?: string;
    corrupt?: boolean;
    isPlanResult?: boolean;
}

export interface QsResultsState {
    present: boolean;
    resultSets: QsResultSetSummary[];
    totalRows: number;
    streaming: boolean;
    messageCount: number;
    errorCount: number;
    planCount: number;
}

export type QsGridLinesMode = "both" | "horizontal" | "vertical" | "none";

/**
 * Results-grid styling snapshot (classic mssql.resultsFontFamily/Size +
 * mssql.resultsGrid.* parity). Always present on QsState; the webview maps
 * it onto CSS custom properties and grid classes.
 */
export interface QsGridStyle {
    fontFamily?: string;
    fontSize?: number;
    alternatingRowColors: boolean;
    showGridLines: QsGridLinesMode;
    rowPadding?: number;
    /**
     * Max complete-result-set row count for client-side sort/filter
     * (mssql.resultsGrid.inMemoryDataProcessingThreshold, classic parity).
     */
    inMemoryDataProcessingThreshold: number;
    /**
     * Grid windowing knobs from the run's QueryTuning snapshot (QO-7):
     * fixed = gridWindowRows per fetch; adaptive = viewport-derived,
     * clamped to [gridWindowRows, gridMaxWindowRows].
     */
    gridWindowMode?: "fixed" | "adaptive";
    gridWindowRows?: number;
    gridPrefetchFactor?: number;
    gridMaxWindowRows?: number;
    /** Text view materialization cap + width-sample size (QO-8). */
    textViewMaxRows?: number;
    textViewSampleRows?: number;
    /** Autosize data-sample row bound (QO-7b). */
    autosizeSampleRows?: number;
    /** Autosize column-width ceiling in px (UX density pass). */
    gridMaxColumnWidthPx?: number;
    /** Maximum display characters transported/rendered for one grid cell. */
    displayCellClamp?: number;
    /** Default editor/results split — results pane height as % (SSMS ~50). */
    resultsPaneHeightPct?: number;
}

export interface QsState {
    schemaVersion: number;
    connection: QsConnectionState;
    execution: QsExecutionState;
    results: QsResultsState;
    editor: { hostVersion: number; language: "sql"; issues: number };
    metadata: { readiness: string; generation?: number; mode?: string };
    completions: { enabled: boolean; degraded?: string };
    toggles: { actualPlan: boolean; viewMode: "grid" | "text"; sqlcmd: boolean };
    gridStyle: QsGridStyle;
    statusMessage: {
        kind: "ready" | "info" | "success" | "warning" | "error";
        text: string;
    };
    capabilities: Record<string, boolean>;
    /** Invalidates renderer-held Vector handles after host-side session reset. */
    vectorSessionEpoch?: number;
    /** Bumped when basemap settings change so panes re-fetch the layer list. */
    spatialBasemapEpoch?: number;
}

// ---------------------------------------------------------------------------
// Hot-path RPC payloads
// ---------------------------------------------------------------------------

export interface QsExecuteParams {
    scope: "selection" | "document";
    selection?: QsSelection;
    estimatedPlanOnly?: boolean;
    parseOnly?: boolean;
}

export interface QsGetRowsParams {
    resultSetId: string;
    start: number;
    count: number;
    /**
     * Consumer fidelity contract. Grid reads carry bounded display previews;
     * copy/text reads preserve exact values. Absent defaults to grid.
     */
    purpose?: "grid" | "copy" | "text";
    /**
     * Horizontal projection (QO-7b): return only this column span. Absent =
     * all columns. Wide-grid viewport and copy reads use bounded spans;
     * transforms, export, and other full-row operations omit the projection.
     */
    columnStart?: number;
    columnCount?: number;
}

export type QsSaveResultFormat = "csv" | "json" | "insert";

export interface QsResultSelectionRange {
    fromRow: number;
    toRow: number;
    fromCell: number;
    toCell: number;
}

export interface QsResultColumn {
    name: string;
    displayName: string;
    sqlType?: string;
    isXml?: boolean;
    isJson?: boolean;
    /**
     * Vector column facts (D-0018/D-0019): safe metadata mirror only —
     * transport truth for the run plus dimensions derived from wire length.
     * Drives the Vector tab's cheap `appliesTo` sniff in the webview shell.
     */
    vector?: {
        transport: "binary-v1" | "textFallback";
        dimensions?: number;
        baseType?: "float32" | "float16";
    };
    /** Native SQL Server spatial column transported as typed WKB for this run. */
    spatial?: {
        kind: "geometry" | "geography";
        encoding: "wkb-v1";
    };
}

/** Compact window (Appendix A): values + null bitmap, never tagged unions. */
export interface QsCellWindow {
    resultSetId: string;
    start: number;
    rowCount: number;
    columns: QsResultColumn[];
    values: unknown[][];
    /** Values are already bounded display text rather than raw cell payloads. */
    valueMode?: "gridPreview";
    /** Flattened row-major cell document classification for preview values. */
    documentLanguages?: Array<"xml" | "json" | null>;
    nullBitmap?: string;
    typeHints?: string[];
    truncatedBitmap?: string;
}

export interface QsMessageRow {
    batchIndex: number;
    repeatOrdinal?: number;
    kind: "info" | "warning" | "error";
    text: string;
    server?: {
        number?: number;
        severity?: number;
        state?: number;
        line?: number;
        procedure?: string;
    };
    epochMs: number;
    navigable?: { line: number; column: number };
}

// ---------------------------------------------------------------------------
// Requests (webview → host)
// ---------------------------------------------------------------------------

export namespace QsSyncEditsRequest {
    export const type = new RequestType<QsSyncEdits, QsSyncEditsResult, void>("qs/syncEdits");
}

/**
 * PERF_MODE-only Vector action accepted by mssql.perf.queryStudioActivateTab.
 * The payload is deliberately composition-only: selected result-row ordinal,
 * catalog selector, metric, K, and variant gate. SQL, pasted vectors, source
 * text, and model input have no representation in this contract.
 */
export interface QsVectorPerfTargetSelector {
    readonly schema: string;
    readonly table: string;
    readonly vectorColumn: string;
}

export interface QsVectorPerfSearchAction {
    readonly source: { readonly kind: "selectedRow"; readonly ordinal: number };
    readonly target: QsVectorPerfTargetSelector;
    readonly metric: "cosine" | "euclidean" | "dot";
    readonly k: number;
    readonly includeApprox: boolean;
}

export type QsVectorPerfAction =
    | { readonly workspace: "projection" }
    | { readonly workspace: "search"; readonly search: QsVectorPerfSearchAction };

export type QsActivatableTab = "results" | "messages" | "queryPlan" | "vector" | "spatial";

/** Host-internal activation after PERF_MODE argument normalization. */
export interface QsActivateTabRequest {
    readonly tab: QsActivatableTab;
    readonly vector?: QsVectorPerfAction;
}

/** Host-to-webview envelope. requestId makes repeated identical actions observable. */
export interface QsActivateTabParams extends QsActivateTabRequest {
    readonly requestId: number;
}

export namespace QsActivateTabNotification {
    // Host-driven results-tab activation (VEC-12 perf seam). Nested Vector
    // actions exist only behind the PERF_MODE command that originates them.
    export const type = new NotificationType<QsActivateTabParams>("qs/activateTab");
}

export type QsPerfScrollTarget = "start" | "middle" | "end";

/**
 * PERF_MODE-only, composition-safe result-surface interactions. The action
 * names an ordinal and a relative target; result values, SQL, schema names,
 * pixels, and arbitrary selectors have no representation in the contract.
 */
export type QsPerfInteractionAction =
    | {
          readonly kind: "scrollGrid";
          readonly resultSetIndex: number;
          readonly axis: "vertical" | "horizontal";
          readonly target: QsPerfScrollTarget;
      }
    | {
          readonly kind: "scrollResultStack";
          readonly target: QsPerfScrollTarget;
      }
    | {
          /** Visit the full result stack in evenly spaced, paint-settled steps. */
          readonly kind: "sweepResultStack";
          readonly steps: number;
      }
    | {
          readonly kind: "selectGrid";
          readonly resultSetIndex: number;
          readonly selection: "all";
      }
    | {
          readonly kind: "copyGrid";
          readonly resultSetIndex: number;
          readonly selection: "all";
          readonly includeHeaders: boolean;
      }
    | {
          /** Host-direct, bounded Copy All for the virtualized Messages pane. */
          readonly kind: "copyMessages";
      };

export interface QsPerfInteractionParams {
    readonly requestId: number;
    readonly action: QsPerfInteractionAction;
}

export namespace QsPerfInteractionNotification {
    export const type = new NotificationType<QsPerfInteractionParams>("qs/perfInteraction");
}
export namespace QsShowCommandPaletteRequest {
    // F1 inside the embedded Monaco must open the VS CODE palette (commands
    // route to the editor through VS Code), not Monaco's own quick-command.
    export const type = new RequestType<void, void, void>("qs/showCommandPalette");
}
export namespace QsSyncAdoptRequest {
    // Webview-authoritative full-text adoption: heals stale-base deadlock
    // (missed init/remote). The editor content is the user-facing truth.
    export const type = new RequestType<
        { text: string; editGroupId: string },
        { applied: boolean; hostVersion: number },
        void
    >("qs/syncAdopt");
}
export namespace QsSyncResyncRequest {
    export const type = new RequestType<
        { webviewVersion: number; textHash: string },
        QsSyncResync,
        void
    >("qs/syncResyncRequest");
}
export namespace QsSyncUndoRequest {
    export const type = new RequestType<{ redo: boolean }, void, void>("qs/syncUndo");
}
export namespace QsSyncSaveRequest {
    export const type = new RequestType<void, void, void>("qs/syncSave");
}
export namespace QsExecuteRequest {
    export const type = new RequestType<
        QsExecuteParams,
        { started: boolean; reason?: string },
        void
    >("qs/execute");
}
export namespace QsCancelRequest {
    export const type = new RequestType<void, { acknowledged: boolean }, void>("qs/cancel");
}
export namespace QsConnectRequest {
    export const type = new RequestType<{ change?: boolean }, { connected: boolean }, void>(
        "qs/connect",
    );
}
export namespace QsDisconnectRequest {
    export const type = new RequestType<void, { disconnected: boolean }, void>("qs/disconnect");
}
export namespace QsReconnectRequest {
    export const type = new RequestType<void, { connected: boolean }, void>("qs/reconnect");
}
export namespace QsSetDatabaseRequest {
    export const type = new RequestType<
        { database: string },
        { changed: boolean; reason?: string },
        void
    >("qs/setDatabase");
}
export namespace QsListDatabasesRequest {
    export const type = new RequestType<void, { databases: string[] }, void>("qs/listDatabases");
}
export namespace QsGetRowsRequest {
    export const type = new RequestType<QsGetRowsParams, QsCellWindow, void>("qs/getRows");
}
/**
 * Host-direct exact grid copy. Large values never make an avoidable
 * RowStore → webview → host round trip before reaching the OS clipboard.
 */
export interface QsCopySelectionResult {
    outcome: "copied" | "tooLarge" | "empty";
    characters: number;
    fetchCount: number;
    fetchMs: number;
    formatMs: number;
    clipboardMs: number;
    windowRows: number;
    rows?: number;
    columns?: number;
    cells?: number;
    reason?: "ranges" | "rows" | "cells" | "characters";
}
export namespace QsCopySelectionToClipboardRequest {
    export const type = new RequestType<
        {
            resultSetId: string;
            selection: QueryStudioGridCopyRange[];
            includeHeaders: boolean;
        },
        QsCopySelectionResult,
        void
    >("qs/copySelectionToClipboard");
}
/** Rare fallback when the webview Clipboard API loses focus/permission after an async copy. */
export namespace QsWriteClipboardRequest {
    export const type = new RequestType<{ text: string }, { written: true }, void>(
        "qs/writeClipboard",
    );
}
export namespace QsSaveResultRequest {
    export const type = new RequestType<
        {
            resultSetId: string;
            format: QsSaveResultFormat;
            selection?: QsResultSelectionRange[];
        },
        { saved: boolean; canceled?: boolean; error?: string },
        void
    >("qs/saveResult");
}
/**
 * Open one cell's content in a side-by-side text document (classic
 * openFileThroughLink parity). XML/JSON pretty-print; "text" opens the raw
 * cell text as plaintext (display-clamped huge cells). NULL cells never
 * produce this request.
 */
export namespace QsOpenCellDocumentRequest {
    export const type = new RequestType<
        { resultSetId: string; row: number; column: number; format: "xml" | "json" | "text" },
        { opened: boolean },
        void
    >("qs/openCellDocument");
}
/**
 * Open a plan-flagged result set (canonical single-cell showplan XML) in
 * the existing execution-plan viewer webview (QS-1: plans render as plan
 * views, not grids). {opened:false} when the set is not a plan, the cell
 * is empty, or the viewer seam is unavailable.
 */
export namespace QsOpenPlanRequest {
    export const type = new RequestType<{ resultSetId: string }, { opened: boolean }, void>(
        "qs/openPlan",
    );
}
/**
 * Load plan-flagged result sets into the execution-plan graph state used by
 * the existing plan renderer. Query Studio keeps this embedded in its own tab;
 * QsOpenPlanRequest remains the "Open in New Tab" escape hatch.
 */
export namespace QsGetPlanStateRequest {
    export const type = new RequestType<
        { resultSetIds: string[] },
        { executionPlanState?: ExecutionPlanState; error?: string },
        void
    >("qs/getPlanState");
}
export namespace QsSaveExecutionPlanRequest {
    export const type = new RequestType<{ sqlPlanContent: string }, void, void>(
        "qs/saveExecutionPlan",
    );
}
export namespace QsShowPlanXmlRequest {
    export const type = new RequestType<{ sqlPlanContent: string }, void, void>("qs/showPlanXml");
}
export namespace QsShowPlanQueryRequest {
    export const type = new RequestType<{ query: string }, void, void>("qs/showPlanQuery");
}
export namespace QsGetMessagesRequest {
    export const type = new RequestType<
        { afterIndex?: number },
        {
            startIndex: number;
            nextIndex: number;
            totalCount: number;
            textCharacters: number;
            hasMore: boolean;
            messages: QsMessageRow[];
        },
        void
    >("qs/getMessages");
}
export interface QsCopyMessagesResult {
    outcome: "copied" | "tooLarge" | "empty";
    messages: number;
    characters: number;
    buildMs: number;
    clipboardMs: number;
    reason?: "messages" | "characters";
}

export namespace QsCopyMessagesToClipboardRequest {
    /** Bounded host-direct Messages Copy All; raw text never returns to the webview. */
    export const type = new RequestType<Record<string, never>, QsCopyMessagesResult, void>(
        "qs/copyMessagesToClipboard",
    );
}
export namespace QsNavigateToLineRequest {
    export const type = new RequestType<{ line: number; column?: number }, void, void>(
        "qs/navigateToLine",
    );
}
export namespace QsSetViewModeRequest {
    export const type = new RequestType<{ viewMode: "grid" | "text" }, void, void>(
        "qs/setViewMode",
    );
}
export namespace QsSetActualPlanRequest {
    export const type = new RequestType<{ enabled: boolean }, void, void>("qs/setActualPlan");
}
export namespace QsSetSqlcmdModeRequest {
    export const type = new RequestType<{ enabled: boolean }, void, void>("qs/setSqlcmdMode");
}

export interface QsInlineCompletionParams {
    /** 0-based document line. */
    line: number;
    /** 0-based UTF-16 column. */
    character: number;
    /** Hash of the webview text the position was computed against. */
    textHash?: string;
    trigger: "automatic" | "invoke";
}

export interface QsInlineCompletionResult {
    /** Ghost text to insert at the cursor; empty means no completion. */
    text: string;
    /** Debug-store event id (present when debug capture is on). */
    eventId?: string;
}

export namespace QsInlineCompletionRequest {
    export const type = new RequestType<QsInlineCompletionParams, QsInlineCompletionResult, void>(
        "qs/inlineCompletion",
    );
}

export namespace QsInlineCompletionAcceptedRequest {
    export const type = new RequestType<{ eventId?: string }, void, void>(
        "qs/inlineCompletionAccepted",
    );
}
export namespace QsPinResultSetRequest {
    /** C2D-2: freeze one complete result set into a pinned snapshot document. */
    export const type = new RequestType<
        { resultSetId: string },
        { opened: boolean; snapshotId?: string; error?: string },
        void
    >("qs/pinResultSet");
}
export namespace QsPinAllResultsRequest {
    /** C2D-2: freeze every complete result set into one pinned document. */
    export const type = new RequestType<
        Record<string, never>,
        { opened: boolean; snapshotId?: string; error?: string },
        void
    >("qs/pinAllResults");
}
/** One selected rectangle, DISPLAY row space (source-id mapping is C2D-T). */
export interface QsGridSelectionRange {
    fromRow: number;
    toRow: number;
    fromCell: number;
    toCell: number;
}

/**
 * Active-result context update (C2D-4): selection SHAPE only — never cell
 * values. Ranges are capped by the sender; larger selections send counts.
 */
export interface QsGridSelectionUpdate {
    resultSetId: string;
    active?: { row: number; column: number };
    /** Source-row spatial selection; intentionally not an active grid cell. */
    spatial?: { row: number; column: number };
    ranges?: QsGridSelectionRange[];
    selectedCellCount?: number;
    selectedRowCount?: number;
    displayedRowCount?: number;
    reason: "selection" | "focus" | "spatial";
    /** Stamped host-side for pinned documents; webviews leave it unset. */
    snapshotView?: { snapshotId: string };
}

export namespace QsUpdateGridSelectionRequest {
    export const type = new RequestType<QsGridSelectionUpdate, void, void>(
        "qs/updateGridSelection",
    );
}
export namespace QsGetDiagnosticsSummaryRequest {
    export const type = new RequestType<
        void,
        { rowsStreamed: number; traceMode: string; replayArmed: boolean; syncResyncCount: number },
        void
    >("qs/getDiagnosticsSummary");
}

// ---------------------------------------------------------------------------
// Notifications (host → webview)
// ---------------------------------------------------------------------------

export namespace QsStateChangedNotification {
    export const type = new NotificationType<QsState>("qs/stateChanged");
}
export namespace QsRunStartedNotification {
    export const type = new NotificationType<{ startedEpochMs: number }>("qs/runStarted");
}
export namespace QsSyncInitNotification {
    export const type = new NotificationType<QsSyncInit>("qs/syncInit");
}
export namespace QsSyncRemoteNotification {
    export const type = new NotificationType<QsSyncRemote>("qs/syncRemote");
}
export namespace QsSyncResyncNotification {
    export const type = new NotificationType<QsSyncResync>("qs/syncResync");
}
export namespace QsRevealPositionNotification {
    export const type = new NotificationType<{ line: number; column: number; flash?: boolean }>(
        "qs/revealPosition",
    );
}
export namespace QsRestoreEditorFocusNotification {
    export const type = new NotificationType<void>("qs/restoreEditorFocus");
}
/** Counts ONLY — row data crosses exclusively via QsGetRows (addendum §3.6). */
export namespace QsRowsAppendedNotification {
    export const type = new NotificationType<{
        resultSetId: string;
        newRowCount: number;
        complete: boolean;
    }>("qs/rowsAppended");
}
export namespace QsResultSetStartedNotification {
    export const type = new NotificationType<QsResultSetSummary>("qs/resultSetStarted");
}
export namespace QsResultSetEndedNotification {
    export const type = new NotificationType<{
        resultSetId: string;
        rowCount: number;
        truncatedReason?: string;
    }>("qs/resultSetEnded");
}
export namespace QsMessagesAppendedNotification {
    /**
     * Position-addressed batch (QO-7): `startIndex` is the host's absolute
     * index of `messages[0]`, so coalesced batches and the catch-up fetch
     * can interleave without duplicating rows.
     */
    export const type = new NotificationType<{ startIndex: number; messages: QsMessageRow[] }>(
        "qs/messagesAppended",
    );
}
export namespace QsToastNotification {
    export const type = new NotificationType<{ kind: "info" | "warning" | "error"; text: string }>(
        "qs/toast",
    );
}
