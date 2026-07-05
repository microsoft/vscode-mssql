/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-panel Query Studio controller: hosts the provided CustomTextEditor
 * webview panel through the standard WebviewBaseController RPC machinery
 * (the Debug Console pattern), bridges the shared document model's text
 * sync, and pushes coarse QsState (≤10/s). Execution/connection RPCs are
 * honest M0 stubs: they answer with the not-yet-available reason instead of
 * pretending (every visible UI state has a model state behind it).
 */

import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import { WebviewBaseController } from "../controllers/webviewBaseController";
import {
    QS_SCHEMA_VERSION,
    QsCancelRequest,
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

        // Initial sync payload once the webview is live.
        void this.sendNotification(QsSyncInitNotification.type, this.model.syncInit());
        this.queueStatePush();
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
        state.statusMessage =
            state.connection.kind === "connected" || state.connection.kind === "executing"
                ? { kind: "info", text: "Connected." }
                : state.connection.kind === "connecting"
                  ? { kind: "info", text: "Connecting…" }
                  : state.connection.kind === "lost"
                    ? { kind: "warning", text: "Connection lost." }
                    : { kind: "ready", text: "Ready — not connected" };
        return state;
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

        // --- honest M0 stubs (connection/execution land in B2/B3) ------------
        // Execution lands in B3/M2; connect is real from M1.
        const executionNotReady = {
            started: false,
            reason: "Execution lands with the results core (M2)",
        };
        this.onRequest(QsExecuteRequest.type, async () => executionNotReady);
        this.onRequest(QsCancelRequest.type, async () => ({ acknowledged: false }));
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
        this.onRequest(QsSetDatabaseRequest.type, async () => ({ changed: false }));
        this.onRequest(QsListDatabasesRequest.type, async () => ({ databases: [] }));
        this.onRequest(QsGetRowsRequest.type, async (params) => ({
            resultSetId: params.resultSetId,
            start: params.start,
            rowCount: 0,
            columns: [],
            values: [],
        }));
        this.onRequest(QsGetMessagesRequest.type, async () => ({ messages: [] }));
        this.onRequest(QsNavigateToLineRequest.type, async () => undefined);
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
        super.dispose();
    }
}
