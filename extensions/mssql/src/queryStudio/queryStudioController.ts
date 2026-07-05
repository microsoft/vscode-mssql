/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-panel Query Studio controller: hosts the provided CustomTextEditor
 * webview panel through the standard WebviewBaseController RPC machinery
 * (the Debug Console pattern), bridges the shared document model's text
 * sync, subscribes to the shared ExecutionHost (results/messages fan-out),
 * and pushes coarse QsState (≤10/s). Rows never ride notifications —
 * counts only; the grid pulls windows via QsGetRows (addendum §3.6).
 */

import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import { WebviewBaseController } from "../controllers/webviewBaseController";
import {
    QS_SCHEMA_VERSION,
    QsCancelRequest,
    QsExecuteParams,
    QsMessagesAppendedNotification,
    QsResultSetEndedNotification,
    QsResultSetStartedNotification,
    QsRevealPositionNotification,
    QsRowsAppendedNotification,
    QsConnectRequest,
    QsDisconnectRequest,
    QsExecuteRequest,
    QsGetDiagnosticsSummaryRequest,
    QsGetMessagesRequest,
    QsGetRowsRequest,
    QsListDatabasesRequest,
    QsNavigateToLineRequest,
    QsReconnectRequest,
    QsSetActualPlanRequest,
    QsSetDatabaseRequest,
    QsSetViewModeRequest,
    QsState,
    QsStateChangedNotification,
    QsSyncEditsRequest,
    QsSyncInitNotification,
    QsSyncRemoteNotification,
    QsSyncResyncNotification,
    QsSyncResyncRequest,
    QsSyncSaveRequest,
    QsSyncUndoRequest,
    QsUpdateGridSelectionRequest,
} from "../sharedInterfaces/queryStudio";
import { QueryStudioDocumentModel } from "./queryStudioDocumentModel";

const STATE_PUSH_MIN_INTERVAL_MS = 100; // ≤10/s per doc 04 §9.1

export class QueryStudioController extends WebviewBaseController<QsState, void> {
    private openMarkerEnded = false;
    private modelListener: vscode.Disposable;
    private bindingListener: vscode.Disposable | undefined;
    private executionListener: { dispose(): void } | undefined;
    private statePushTimer: NodeJS.Timeout | undefined;
    private lastStatePush = 0;
    private viewMode: "grid" | "text" = "grid";
    private actualPlan = false;

    constructor(
        context: vscode.ExtensionContext,
        private readonly panel: vscode.WebviewPanel,
        private readonly model: QueryStudioDocumentModel,
    ) {
        super(context, "queryStudio", QueryStudioController.initialState(model), "queryStudio");
        this.panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)],
        };
        this.panel.webview.html = this._getHtmlTemplate();
        // Bind the RPC reader/writer to the PROVIDED panel's webview — the
        // panel-owning base class does this in createWebviewPanel; a custom
        // editor must do it explicitly or every message drops with
        // "webview is not set".
        this.updateConnectionWebview(this.panel.webview);
        this.registerDisposable(
            this.panel.webview.onDidReceiveMessage((message: unknown) => {
                const m = message as { type?: string; message?: string; source?: string };
                if (m?.type === "qsBootError") {
                    this.logger.error(
                        `Query Studio webview boot error: ${m.message} @ ${m.source}`,
                    );
                }
            }),
        );
        this.initializeBase();
        this.registerHandlers();

        this.modelListener = this.model.attachListener({
            onRemote: (remote) => {
                void this.sendNotification(QsSyncRemoteNotification.type, remote);
                this.queueStatePush();
            },
            onResync: (resync) => {
                void this.sendNotification(QsSyncResyncNotification.type, resync);
            },
        });

        this.bindingListener = this.model.sessionBinding.onDidChange(() => this.queueStatePush());

        this.executionListener = this.model.executionHost.attach({
            onResultSetStarted: (summary) => {
                void this.sendNotification(QsResultSetStartedNotification.type, summary);
                this.queueStatePush();
            },
            onRowsAppended: (resultSetId, newRowCount, complete) => {
                void this.sendNotification(QsRowsAppendedNotification.type, {
                    resultSetId,
                    newRowCount,
                    complete,
                });
            },
            onResultSetEnded: (resultSetId, rowCount, truncatedReason) => {
                void this.sendNotification(QsResultSetEndedNotification.type, {
                    resultSetId,
                    rowCount,
                    ...(truncatedReason ? { truncatedReason } : {}),
                });
                this.queueStatePush();
            },
            onMessages: (messages) => {
                void this.sendNotification(QsMessagesAppendedNotification.type, { messages });
                this.queueStatePush();
            },
            onExecutionStateChanged: () => this.queueStatePush(),
        });

        // Initial sync payload once the webview is live.
        void this.sendNotification(QsSyncInitNotification.type, this.model.syncInit());
        this.queueStatePush();
    }

    protected override _getHtmlTemplate(): string {
        // Boot-failure visibility: webview console errors are invisible to
        // the host/harness — relay window errors before the bundle loads.
        const relay =
            "<script>" +
            "window.__vscodeApiPreAcquired = acquireVsCodeApi();" +
            "const __qsr = (m, s) => window.__vscodeApiPreAcquired.postMessage(" +
            "{ type: 'qsBootError', message: String(m).slice(0, 500), source: String(s || '').slice(0, 200) });" +
            "window.addEventListener('error', (e) => __qsr(e.message, (e.filename || '') + ':' + e.lineno));" +
            "window.addEventListener('unhandledrejection', (e) => " +
            "__qsr(e.reason && e.reason.stack ? e.reason.stack : e.reason, 'promise'));" +
            "</" +
            "script>";
        return super._getHtmlTemplate().replace("<body>", "<body>" + relay);
    }

    protected _getWebview(): vscode.Webview {
        return this.panel.webview;
    }

    private static initialState(model: QueryStudioDocumentModel): QsState {
        return {
            schemaVersion: QS_SCHEMA_VERSION,
            connection: { kind: "disconnected" },
            execution: { kind: "idle" },
            results: {
                present: false,
                resultSets: [],
                totalRows: 0,
                streaming: false,
                messageCount: 0,
                errorCount: 0,
                planCount: 0,
            },
            editor: { hostVersion: model.hostVersion, language: "sql", issues: 0 },
            metadata: { readiness: "absent" },
            completions: { enabled: false },
            toggles: { actualPlan: false, viewMode: "grid" },
            statusMessage: { kind: "ready", text: "Ready — not connected" },
            capabilities: {},
        };
    }

    private currentState(): QsState {
        const state = QueryStudioController.initialState(this.model);
        state.editor.hostVersion = this.model.hostVersion;
        state.toggles = { actualPlan: this.actualPlan, viewMode: this.viewMode };
        state.connection = this.model.sessionBinding.connectionState;
        state.execution = { ...this.model.executionHost.executionState };
        if (state.execution.kind === "executing" && state.execution.startedEpochMs) {
            state.execution.elapsedMs = Date.now() - state.execution.startedEpochMs;
        }
        state.results = this.model.executionHost.resultsState();
        state.statusMessage = QueryStudioController.statusFor(state);
        return state;
    }

    private static statusFor(state: QsState): QsState["statusMessage"] {
        switch (state.execution.kind) {
            case "executing":
                return { kind: "info", text: "Executing query…" };
            case "cancelRequested":
                return { kind: "warning", text: "Cancel requested…" };
            case "succeeded":
                return { kind: "success", text: "Query executed successfully." };
            case "completedWithErrors":
                return { kind: "error", text: "Completed with errors." };
            case "failed":
                return { kind: "error", text: "Query failed." };
            case "canceled":
                return { kind: "warning", text: "Query was cancelled." };
            case "connectionLost":
                return { kind: "error", text: "Connection lost during execution." };
        }
        return state.connection.kind === "connected"
            ? { kind: "info", text: "Connected." }
            : state.connection.kind === "connecting"
              ? { kind: "info", text: "Connecting…" }
              : state.connection.kind === "lost"
                ? { kind: "warning", text: "Connection lost." }
                : { kind: "ready", text: "Ready — not connected" };
    }

    private queueStatePush(): void {
        const now = Date.now();
        const wait = Math.max(0, STATE_PUSH_MIN_INTERVAL_MS - (now - this.lastStatePush));
        if (this.statePushTimer) {
            return;
        }
        this.statePushTimer = setTimeout(() => {
            this.statePushTimer = undefined;
            this.lastStatePush = Date.now();
            void this.sendNotification(QsStateChangedNotification.type, this.currentState());
        }, wait);
        this.statePushTimer.unref?.();
    }

    private registerHandlers(): void {
        // --- text sync -----------------------------------------------------
        this.onRequest(QsSyncEditsRequest.type, async (edits) =>
            this.model.applyWebviewEdits(edits),
        );
        this.onRequest(QsSyncResyncRequest.type, async ({ webviewVersion, textHash }) =>
            this.model.resyncFor(webviewVersion, textHash),
        );
        this.onRequest(QsSyncUndoRequest.type, async ({ redo }) => this.model.undo(redo));
        this.onRequest(QsSyncSaveRequest.type, async () => this.model.save());

        // --- webview ready signal: end the open marker once -----------------
        this.onRequest(QsGetDiagnosticsSummaryRequest.type, async () => {
            if (!this.openMarkerEnded) {
                this.openMarkerEnded = true;
                Perf.marker("mssql.queryStudio.open.end", "end", { fromCache: false });
            }
            return {
                rowsStreamed: 0,
                traceMode: "digests",
                replayArmed: false,
                syncResyncCount: this.model.syncResyncCount,
            };
        });

        // --- execution (M2): shared ExecutionHost, honest refusals -----------
        this.onRequest(QsExecuteRequest.type, async (params: QsExecuteParams) => {
            const doc = this.model.backingDocument;
            let text = doc.getText();
            let selectionStartLine = 1;
            let scope: "selection" | "document" = "document";
            if (params.scope === "selection" && params.selection) {
                const sel = params.selection;
                const range = new vscode.Range(
                    sel.startLine - 1,
                    sel.startColumn - 1,
                    sel.endLine - 1,
                    sel.endColumn - 1,
                );
                const sliced = doc.getText(range);
                if (sliced.trim().length > 0) {
                    text = sliced;
                    selectionStartLine = sel.startLine;
                    scope = "selection";
                }
            }
            const mode = params.parseOnly
                ? ("parseOnly" as const)
                : params.estimatedPlanOnly
                  ? ("estimatedPlan" as const)
                  : this.actualPlan
                    ? ("actualPlan" as const)
                    : ("normal" as const);
            const outcome = this.model.executionHost.execute(text, {
                selectionStartLine,
                scope,
                mode,
            });
            this.queueStatePush();
            return outcome;
        });
        this.onRequest(QsCancelRequest.type, async () => this.model.executionHost.cancel());
        this.onRequest(QsConnectRequest.type, async () => {
            const connected = await this.model.sessionBinding.connect();
            this.queueStatePush();
            return { connected };
        });
        this.onRequest(QsDisconnectRequest.type, async () => {
            const disconnected = await this.model.sessionBinding.disconnect();
            this.queueStatePush();
            return { disconnected };
        });
        this.onRequest(QsReconnectRequest.type, async () => {
            const connected = await this.model.sessionBinding.connect();
            this.queueStatePush();
            return { connected };
        });
        this.onRequest(QsSetDatabaseRequest.type, async ({ database }) => {
            const changed = await this.model.executionHost.setDatabase(database);
            this.queueStatePush();
            return { changed };
        });
        this.onRequest(QsListDatabasesRequest.type, async () => ({
            databases: await this.model.executionHost.listDatabases(),
        }));
        this.onRequest(QsGetRowsRequest.type, async (params) =>
            this.model.executionHost.getRows(params.resultSetId, params.start, params.count),
        );
        this.onRequest(QsGetMessagesRequest.type, async (params) =>
            this.model.executionHost.getMessages(params?.afterIndex),
        );
        this.onRequest(QsNavigateToLineRequest.type, async ({ line, column }) => {
            // The editor lives in the webview: bounce a reveal notification.
            void this.sendNotification(QsRevealPositionNotification.type, {
                line,
                column: column ?? 1,
                flash: true,
            });
        });
        this.onRequest(QsSetViewModeRequest.type, async ({ viewMode }) => {
            this.viewMode = viewMode;
            this.queueStatePush();
        });
        this.onRequest(QsSetActualPlanRequest.type, async ({ enabled }) => {
            this.actualPlan = enabled;
            this.queueStatePush();
        });
        this.onRequest(QsUpdateGridSelectionRequest.type, async () => undefined);
    }

    public override dispose(): void {
        if (this.statePushTimer) {
            clearTimeout(this.statePushTimer);
        }
        this.modelListener.dispose();
        this.bindingListener?.dispose();
        this.executionListener?.dispose();
        super.dispose();
    }
}
