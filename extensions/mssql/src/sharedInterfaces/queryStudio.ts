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
    loginName?: string;
    spid?: number;
    database?: string;
    encrypted?: boolean;
    accentColor?: string;
    backend?: string;
    lostReason?: string;
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
    rowCount: number;
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

export interface QsState {
    schemaVersion: number;
    connection: QsConnectionState;
    execution: QsExecutionState;
    results: QsResultsState;
    editor: { hostVersion: number; language: "sql"; issues: number };
    metadata: { readiness: string; generation?: number; mode?: string };
    completions: { enabled: boolean; degraded?: string };
    toggles: { actualPlan: boolean; viewMode: "grid" | "text" };
    statusMessage: {
        kind: "ready" | "info" | "success" | "warning" | "error";
        text: string;
    };
    capabilities: Record<string, boolean>;
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
}

/** Compact window (Appendix A): values + null bitmap, never tagged unions. */
export interface QsCellWindow {
    resultSetId: string;
    start: number;
    rowCount: number;
    columns: Array<{ name: string; displayName: string; sqlType?: string }>;
    values: unknown[][];
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
    export const type = new RequestType<{ database: string }, { changed: boolean }, void>(
        "qs/setDatabase",
    );
}
export namespace QsListDatabasesRequest {
    export const type = new RequestType<void, { databases: string[] }, void>("qs/listDatabases");
}
export namespace QsGetRowsRequest {
    export const type = new RequestType<QsGetRowsParams, QsCellWindow, void>("qs/getRows");
}
export namespace QsGetMessagesRequest {
    export const type = new RequestType<
        { afterIndex?: number },
        { messages: QsMessageRow[] },
        void
    >("qs/getMessages");
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
export namespace QsUpdateGridSelectionRequest {
    export const type = new RequestType<
        { row?: number; column?: number; rangeRows?: number; rangeCols?: number },
        void,
        void
    >("qs/updateGridSelection");
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
    export const type = new NotificationType<{ messages: QsMessageRow[] }>("qs/messagesAppended");
}
export namespace QsToastNotification {
    export const type = new NotificationType<{ kind: "info" | "warning" | "error"; text: string }>(
        "qs/toast",
    );
}
