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
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import { runScanRules } from "./scanDetect";
import { QUERY_STUDIO_SCAN_RULES } from "./scanDetectRules";
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
    QsGetMessagesTextRequest,
    QsGetPlanStateRequest,
    QsGetRowsRequest,
    QsGridStyle,
    QsMessageRow,
    QsOpenCellDocumentRequest,
    QsOpenPlanRequest,
    QsInlineCompletionAcceptedRequest,
    QsInlineCompletionRequest,
    QsListDatabasesRequest,
    QsNavigateToLineRequest,
    QsReconnectRequest,
    QsRestoreEditorFocusNotification,
    QsRunStartedNotification,
    QsSaveExecutionPlanRequest,
    QsSaveResultRequest,
    QsSetActualPlanRequest,
    QsSetSqlcmdModeRequest,
    QsSetDatabaseRequest,
    QsSetViewModeRequest,
    QsState,
    QsStateChangedNotification,
    QsShowCommandPaletteRequest,
    QsShowPlanQueryRequest,
    QsShowPlanXmlRequest,
    QsSyncAdoptRequest,
    QsActivateTabNotification,
    QsSyncEditsRequest,
    QsSyncInitNotification,
    QsSyncRemoteNotification,
    QsSyncResyncNotification,
    QsSyncResyncRequest,
    QsPinAllResultsRequest,
    QsPinResultSetRequest,
    QsSyncSaveRequest,
    QsSyncUndoRequest,
    QsUpdateGridSelectionRequest,
} from "../sharedInterfaces/queryStudio";
import { getQueryResultContextService } from "../queryResults/queryResultContextService";
import { pinSourceResults } from "../queryResults/pinCommands";
import { buildMessagesText } from "../sharedInterfaces/queryStudioMessages";
import { resolveQueryTuning } from "./tuning/queryTuningResolver";
import { VectorWorkbenchService } from "../queryResults/vector/vectorWorkbenchService";
import { SpatialSessionManager } from "../queryResults/spatial/spatialSessionManager";
import {
    QsSpatialCancelRequest,
    QsSpatialCloseRequest,
    QsSpatialNextRequest,
    QsSpatialOpenRequest,
} from "../sharedInterfaces/spatialResults";
import {
    QsVectorCancelRequest,
    QsVectorCloseRequest,
    QsVectorCompareRequest,
    QsVectorFindingDetailRequest,
    QsVectorOpenRequest,
    QsVectorProfileRequest,
    QsVectorProjectionRequest,
} from "../sharedInterfaces/vectorWorkbench";
import { QsVectorCapabilitiesRequest } from "../sharedInterfaces/vectorCatalog";
import { QsVectorIndexStateRequest } from "../sharedInterfaces/vectorIndex";
import { VectorIndexService } from "../queryResults/vector/vectorIndexService";
import { VectorModelStatementCounter } from "../queryResults/vector/vectorModelStatementCounter";
import { VectorPipelineService } from "../queryResults/vector/vectorPipelineService";
import { VectorSearchService } from "../queryResults/vector/vectorSearchService";
import {
    QsVectorChunkPreviewRequest,
    QsVectorPipelineCancelRequest,
    QsVectorPipelineStateRequest,
    QsVectorReembedExecuteRequest,
    QsVectorReembedPrepareRequest,
    QsVectorReembedResultRequest,
} from "../sharedInterfaces/vectorPipeline";
import {
    QsVectorSearchCancelRequest,
    QsVectorSearchModelExecuteRequest,
    QsVectorSearchModelPrepareRequest,
    QsVectorSearchModelsRequest,
    QsVectorSearchRequest,
    QsVectorSearchResultRequest,
    QsVectorSearchTargetsRequest,
} from "../sharedInterfaces/vectorSearch";
import {
    QsLangCompletionRequest,
    QsLangDefinitionRequest,
    QsLangDiagnosticsChangedNotification,
    QsLangDiagnosticsRequest,
    QsLangDocumentSymbolsRequest,
    QsLangFoldingRequest,
    QsLangHoverRequest,
    QsLangSignatureHelpRequest,
    QsLangStatusRequest,
} from "../sharedInterfaces/queryStudioLanguage";
import { isInlineCompletionFeatureEnabled } from "../copilot/inlineCompletionFeatureGate";
import { getSharedInlineCompletionProvider } from "../copilot/inlineCompletionShared";
import SqlDocumentService from "../controllers/sqlDocumentService";
import { definitionContentProvider, openScriptedDefinition } from "./definitionContentProvider";
import { QueryStudioDocumentModel } from "./queryStudioDocumentModel";
import {
    DIAGNOSTICS_ENABLED_SETTING,
    LANGUAGE_ENGINE_SETTING,
    LanguageServiceStatus,
    QueryStudioLanguageService,
} from "./queryStudioLanguageService";
import { cellDocumentText, prettyPrintCellText } from "./cellDocument";
import {
    createExecutionPlanGraphs,
    openExecutionPlanWebview,
    saveExecutionPlan,
    showPlanXml,
    showQuery,
} from "../controllers/sharedExecutionPlanUtils";
import { ExecutionPlanWebviewState } from "../sharedInterfaces/executionPlan";
import { ExecutionPlanService } from "../services/executionPlanService";
import { ApiStatus } from "../sharedInterfaces/webview";
import { readGridStyle } from "./gridStyle";
import { executionTimeoutMs, readQuerySessionOptions } from "./sessionOptions";
import { saveQueryStudioResult } from "./resultExport";
import {
    QueryStudioPanelViewState,
    QsGetPanelViewStateRequest,
    QsUpdatePanelViewStateNotification,
    createQueryStudioPanelViewState,
    normalizeQueryStudioPanelViewState,
    resetQueryStudioPanelViewState,
} from "../sharedInterfaces/queryStudioViewState";

const STATE_PUSH_MIN_INTERVAL_MS = 100; // ≤10/s per doc 04 §9.1
/** Scan-and-detect: idle beat after the webview is ready (plan §3.4). */
const OPEN_SCAN_DELAY_MS = 1_500;

export class QueryStudioController extends WebviewBaseController<QsState, void> {
    private openMarkerEnded = false;
    private modelListener: vscode.Disposable;
    private bindingListener: vscode.Disposable | undefined;
    private executionListener: { dispose(): void } | undefined;
    private statePushTimer: NodeJS.Timeout | undefined;
    private lastStatePush = 0;
    // Notification coalescing (QO-7): buffers flushed per the run's tuning
    // intervals (0 = immediate), and always on completion/terminal edges.
    private pendingRows = new Map<string, { newRowCount: number; complete: boolean }>();
    private rowsFlushTimer: NodeJS.Timeout | undefined;
    private rowsNotifyIntervalMs = 0;
    private pendingMessages: QsMessageRow[] = [];
    private messagesFlushTimer: NodeJS.Timeout | undefined;
    private messagesNotifyIntervalMs = 0;
    /** Absolute index of the next message row to notify (reset per run). */
    private messagesSentCount = 0;
    /** Parsed plan graphs for the current run's plan XML (QO-8). */
    private planStateCache:
        | { key: string; state: ExecutionPlanWebviewState["executionPlanState"] }
        | undefined;
    private viewMode: "grid" | "text" = "grid";
    private actualPlan = false;
    private inlineCompletionCts: vscode.CancellationTokenSource | undefined;
    /** Accepted-command args by debug event id ("__last__" when capture is off). */
    private inlineCompletionAcceptedArgs = new Map<string, unknown[]>();
    private readonly languageService: QueryStudioLanguageService;
    /** Database names cached from QsListDatabases for USE completions. */
    private _languageDatabasesCache: string[] | undefined;
    private restoreEditorFocusWhenActive = false;
    /** Vector Workbench sessions (VEC-4) — created on first vector RPC only. */
    private vectorService: VectorWorkbenchService | undefined;
    /** Spatial pull sessions — created only when the lazy pane opens. */
    private spatialService: SpatialSessionManager | undefined;
    /** Monotonic invalidation token for renderer-held Vector handles. */
    private vectorSessionEpoch = 0;
    /** Authoritative per-run statement counts; retained across pane suspension. */
    private vectorPipelineModelStatements = new VectorModelStatementCounter();
    private vectorSearchModelStatements = new VectorModelStatementCounter();
    /** Per-panel, memory-only UI state; deliberately excluded from QsState. */
    private panelViewState: QueryStudioPanelViewState;

    private readonly extensionContext: vscode.ExtensionContext;

    constructor(
        context: vscode.ExtensionContext,
        private readonly panel: vscode.WebviewPanel,
        private readonly model: QueryStudioDocumentModel,
    ) {
        super(context, "queryStudio", QueryStudioController.initialState(model), "queryStudio");
        this.extensionContext = context;
        this.panelViewState = createQueryStudioPanelViewState(
            String(this.model.executionHost.executionState.startedEpochMs ?? "idle"),
        );
        this.panelViewState.shell.resultsHeightPct =
            QueryStudioController.currentGridStyle().resultsPaneHeightPct ?? 50;
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
        this.registerDisposable(
            this.panel.onDidChangeViewState((event) => {
                if (!event.webviewPanel.visible) {
                    // Hidden retained webviews keep their React tree alive.
                    // Revoke analysis sessions host-side and advertise the
                    // visibility transition so the pane atomically drops its
                    // stale handles before reopening when revealed.
                    this.suspendVectorServices();
                    this.queueStatePush();
                    return;
                }
                this.queueStatePush();
                if (!event.webviewPanel.active || !this.restoreEditorFocusWhenActive) {
                    return;
                }
                this.restoreEditorFocusWhenActive = false;
                void this.sendNotification(QsRestoreEditorFocusNotification.type, undefined);
            }),
        );
        this.languageService = new QueryStudioLanguageService({
            backingDocument: () => this.model.backingDocument,
            sessionBinding: () => this.model.sessionBinding,
            databases: () => this._languageDatabasesCache,
            awaitTextHash: (hash, timeoutMs) => this.model.awaitTextHash(hash, timeoutMs),
        });
        this.initializeBase();
        this.registerHandlers();
        this.state = this.currentState();

        this.registerDisposable(
            this.languageService.onDiagnosticsChanged(() => {
                void this.languageService
                    .diagnostics()
                    .then((result) => {
                        if (this.isDisposed) {
                            return;
                        }
                        void this.sendNotification(QsLangDiagnosticsChangedNotification.type, {
                            diagnostics: result?.diagnostics ?? [],
                        });
                    })
                    .catch(() => undefined);
            }),
        );
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(LANGUAGE_ENGINE_SETTING)) {
                    this.languageService.onPreferenceChanged();
                }
                if (
                    e.affectsConfiguration(DIAGNOSTICS_ENABLED_SETTING) ||
                    e.affectsConfiguration("mssql.intelliSense")
                ) {
                    this.languageService.onDiagnosticsSettingChanged();
                }
                if (
                    e.affectsConfiguration("mssql.resultsFontFamily") ||
                    e.affectsConfiguration("mssql.resultsFontSize") ||
                    e.affectsConfiguration("mssql.resultsGrid") ||
                    e.affectsConfiguration("mssql.queryStudio.vectorWorkbench.enabled") ||
                    e.affectsConfiguration("mssql.queryStudio.spatial.enabled")
                ) {
                    if (
                        e.affectsConfiguration("mssql.queryStudio.vectorWorkbench.enabled") &&
                        !this.model.executionHost.vectorWorkbenchGate()
                    ) {
                        this.resetVectorServices();
                    }
                    if (
                        e.affectsConfiguration("mssql.queryStudio.spatial.enabled") &&
                        !this.model.executionHost.spatialResultsGate()
                    ) {
                        this.resetSpatialServices();
                    }
                    this.queueStatePush();
                }
            }),
        );

        this.modelListener = this.model.attachListener({
            onRemote: (remote) => {
                void this.sendNotification(QsSyncRemoteNotification.type, remote);
                this.queueStatePush();
            },
            onResync: (resync) => {
                void this.sendNotification(QsSyncResyncNotification.type, resync);
            },
        });
        // Host-driven tab activation (VEC-12 perf seam / commands).
        this.registerDisposable(
            this.model.onActivateTabRequest((request) => {
                void this.sendNotification(QsActivateTabNotification.type, request);
            }),
        );

        this.bindingListener = this.model.sessionBinding.onDidChange(() => {
            // Database/principal/session changes invalidate catalog bindings
            // and any source handles held by live-only Vector workspaces.
            this.resetVectorServices();
            this.resetSpatialServices();
            this.queueStatePush();
        });

        this.executionListener = this.model.executionHost.attach({
            onRunStarted: (startedEpochMs) => {
                // Per-run notification pacing from the run's tuning snapshot (QO-7).
                const tuning = this.model.executionHost.currentTuning;
                this.rowsNotifyIntervalMs = tuning?.params.rowsNotifyIntervalMs ?? 0;
                this.messagesNotifyIntervalMs = tuning?.params.messagesNotifyIntervalMs ?? 0;
                this.messagesSentCount = 0;
                this.pendingMessages = [];
                this.pendingRows.clear();
                this.panelViewState = resetQueryStudioPanelViewState(
                    this.panelViewState,
                    String(startedEpochMs),
                );
                // A run invalidates every analysis handle and its retained old
                // result store. The pane can lazily create fresh services when
                // it next becomes active.
                this.resetVectorServices();
                this.resetSpatialServices();
                void this.sendNotification(QsRunStartedNotification.type, { startedEpochMs });
                this.queueStatePush();
            },
            onResultSetStarted: (summary) => {
                void this.sendNotification(QsResultSetStartedNotification.type, summary);
                this.queueStatePush();
            },
            onRowsAppended: (resultSetId, newRowCount, complete) => {
                // Coalesced per rowsNotifyIntervalMs (0 = immediate, today's
                // behavior); completion always flushes so final counts land.
                const pending = this.pendingRows.get(resultSetId);
                if (pending) {
                    pending.newRowCount += newRowCount;
                    pending.complete = pending.complete || complete;
                } else {
                    this.pendingRows.set(resultSetId, { newRowCount, complete });
                }
                if (complete || this.rowsNotifyIntervalMs <= 0) {
                    this.flushPendingRows();
                } else if (this.rowsFlushTimer === undefined) {
                    this.rowsFlushTimer = setTimeout(
                        () => this.flushPendingRows(),
                        this.rowsNotifyIntervalMs,
                    );
                }
            },
            onResultSetEnded: (resultSetId, rowCount, truncatedReason) => {
                this.flushPendingRows();
                void this.sendNotification(QsResultSetEndedNotification.type, {
                    resultSetId,
                    rowCount,
                    ...(truncatedReason ? { truncatedReason } : {}),
                });
                this.queueStatePush();
            },
            onMessages: (messages) => {
                this.pendingMessages.push(...messages);
                if (this.messagesNotifyIntervalMs <= 0) {
                    this.flushPendingMessages();
                } else if (this.messagesFlushTimer === undefined) {
                    this.messagesFlushTimer = setTimeout(
                        () => this.flushPendingMessages(),
                        this.messagesNotifyIntervalMs,
                    );
                }
            },
            onExecutionStateChanged: () => {
                // Terminal transitions flush everything so no count is stale.
                this.flushPendingRows();
                this.flushPendingMessages();
                this.queueStatePush();
            },
        });

        // Initial sync payload once the webview is live.
        void this.sendNotification(QsSyncInitNotification.type, this.model.syncInit());
        this.queueStatePush();
    }

    /**
     * Pin (C2D-2/3): freeze complete results into a snapshot and open the
     * readonly pinned document. The creator lease releases after the
     * document has acquired its own — a failed open therefore disposes the
     * snapshot instead of leaking it.
     */
    private pinResults(
        scope: { kind: "resultSet"; resultSetId: string } | { kind: "allCompleteResultSets" },
    ): Promise<{ opened: boolean; snapshotId?: string; error?: string }> {
        return pinSourceResults(this.model.liveResultSource.sourceId, scope);
    }

    private async executionPlanSeam(): Promise<
        | {
              context?: vscode.ExtensionContext;
              executionPlanService: ExecutionPlanService;
              sqlDocumentService: SqlDocumentService;
          }
        | undefined
    > {
        const seam = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
            | {
                  context?: vscode.ExtensionContext;
                  executionPlanService?: ExecutionPlanService;
                  sqlDocumentService?: SqlDocumentService;
              }
            | undefined;
        if (!seam?.executionPlanService || !seam.sqlDocumentService) {
            return undefined;
        }
        return {
            ...(seam.context ? { context: seam.context } : {}),
            executionPlanService: seam.executionPlanService,
            sqlDocumentService: seam.sqlDocumentService,
        };
    }

    private async planXmlForResultSet(resultSetId: string): Promise<string | undefined> {
        const summary = this.model.executionHost
            .resultsState()
            .resultSets.find((set) => set.resultSetId === resultSetId);
        if (!summary?.isPlanResult) {
            return undefined;
        }
        const window = await this.model.executionHost.getRows(resultSetId, 0, 1, "cellDocument");
        const value = window.values[0]?.[0];
        return value === undefined || value === null ? undefined : cellDocumentText(value);
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
            toggles: { actualPlan: false, viewMode: "grid", sqlcmd: false },
            gridStyle: QueryStudioController.currentGridStyle(),
            statusMessage: { kind: "ready", text: "Ready — not connected" },
            capabilities: {
                vectorWorkbench: model.executionHost.vectorWorkbenchGate(),
                spatialResults: model.executionHost.spatialResultsGate(),
                panelVisible: true,
            },
            vectorSessionEpoch: 0,
        };
    }

    /** Grid styling snapshot from live configuration (classic parity). */
    private static currentGridStyle(): QsGridStyle {
        const config = vscode.workspace.getConfiguration();
        return readGridStyle((key) => config.get(key));
    }

    /**
     * Scan-and-detect (SQLCMD_MODE_PLAN.md §3.4): one idle spot-check of the
     * document a short beat after the webview is ready — pluggable rules
     * over a bounded sample, actions owned here. Once per DOCUMENT (the
     * completed flag lives on the shared model, so a second panel doesn't
     * re-prompt).
     */
    private scheduleOpenScan(): void {
        if (
            !vscode.workspace
                .getConfiguration()
                .get<boolean>("mssql.queryStudio.scan.enabled", true)
        ) {
            return;
        }
        const timer = setTimeout(() => this.runOpenScan(), OPEN_SCAN_DELAY_MS);
        timer.unref?.();
    }

    private runOpenScan(): void {
        if (this.isDisposed || this.model.openScanCompleted) {
            return;
        }
        this.model.openScanCompleted = true;
        const started = Date.now();
        const text = this.model.backingDocument.getText();
        const matches = runScanRules(text, QUERY_STUDIO_SCAN_RULES);
        let action = "none";
        if (matches.some((match) => match.id === "psql")) {
            // The ask: "detect if this is a PSQL file and turn off TSQL
            // error detection" — silent, per-document, this session only.
            this.languageService.suppressDocumentDiagnostics("psql");
            action = "psqlSuppress";
        }
        if (
            matches.some((match) => match.id === "sqlcmd") &&
            !this.model.executionHost.sqlcmdEnabled
        ) {
            if (
                vscode.workspace
                    .getConfiguration()
                    .get<boolean>("mssql.queryStudio.scan.autoEnableSqlcmd", false)
            ) {
                this.setSqlcmdMode(true, "scanAuto");
                action = "sqlcmdAuto";
            } else {
                action = "sqlcmdPrompt";
                void this.promptSqlcmdEnable();
            }
        }
        Perf.marker("mssql.queryStudio.scan.run", "instant", {
            rules: QUERY_STUDIO_SCAN_RULES.length,
            matched: matches.length,
            sampledLines: Math.min(50, text.split(/\r?\n/).length),
            ms: Date.now() - started,
            action,
        });
    }

    /** The three-option prompt (the ask — exactly these choices). */
    private async promptSqlcmdEnable(): Promise<void> {
        const enable = "Enable";
        const dontEnable = "Don't Enable";
        const autoEnable = "Don't show again, auto-enable";
        const choice = await vscode.window.showInformationMessage(
            "This file has SQLCMD commands. Do you want to enable SQLCMD mode?",
            enable,
            dontEnable,
            autoEnable,
        );
        if (this.isDisposed) {
            return;
        }
        if (choice === autoEnable) {
            await vscode.workspace
                .getConfiguration()
                .update(
                    "mssql.queryStudio.scan.autoEnableSqlcmd",
                    true,
                    vscode.ConfigurationTarget.Global,
                );
        }
        if (choice === enable || choice === autoEnable) {
            this.setSqlcmdMode(true, "scanPrompt");
        }
        Perf.marker("mssql.queryStudio.scan.run", "instant", {
            action:
                choice === dontEnable || choice === undefined ? "sqlcmdDeclined" : "sqlcmdEnabled",
        });
    }

    /**
     * SQLCMD mode flip (SQLCMD_MODE_PLAN.md §3.3) — one entry point for the
     * toolbar toggle and the scan-and-detect actions so the marker always
     * says who flipped it.
     */
    setSqlcmdMode(enabled: boolean, source: "user" | "scanPrompt" | "scanAuto"): void {
        if (this.model.executionHost.sqlcmdEnabled === enabled) {
            return;
        }
        this.model.executionHost.sqlcmdEnabled = enabled;
        Perf.marker("mssql.queryStudio.sqlcmd.toggle", "instant", { enabled, source });
        this.queueStatePush();
    }

    private currentState(): QsState {
        const state = QueryStudioController.initialState(this.model);
        state.editor.hostVersion = this.model.hostVersion;
        state.toggles = {
            actualPlan: this.actualPlan,
            viewMode: this.viewMode,
            // SQLCMD mode is per-DOCUMENT (v1 per-ownerUri parity): the host
            // owns it so every panel of the document reads the same value.
            sqlcmd: this.model.executionHost.sqlcmdEnabled,
        };
        state.connection = this.model.sessionBinding.connectionState;
        state.execution = { ...this.model.executionHost.executionState };
        if (state.execution.kind === "executing" && state.execution.startedEpochMs) {
            state.execution.elapsedMs = Date.now() - state.execution.startedEpochMs;
        }
        state.results = this.model.executionHost.resultsState();
        const metadata = this.model.sessionBinding.metadataStatus;
        if (metadata) {
            state.metadata = {
                readiness: metadata.readiness,
                generation: metadata.generation,
                mode: metadata.mode,
            };
        }
        state.completions = { enabled: isInlineCompletionFeatureEnabled() };
        state.capabilities.vectorWorkbench = this.model.executionHost.vectorWorkbenchGate();
        state.capabilities.spatialResults = this.model.executionHost.spatialResultsGate();
        state.capabilities.panelVisible = this.panel.visible;
        state.vectorSessionEpoch = this.vectorSessionEpoch;
        // Grid windowing knobs ride the style snapshot (QO-7): the run's
        // tuning when one exists, else the current resolution.
        const tuning = (this.model.executionHost.currentTuning ?? resolveQueryTuning()).params;
        state.gridStyle = {
            ...state.gridStyle,
            gridWindowMode: tuning.gridWindowMode,
            gridWindowRows: tuning.gridWindowRows,
            gridPrefetchFactor: tuning.gridPrefetchFactor,
            gridMaxWindowRows: tuning.gridMaxWindowRows,
            textViewMaxRows: tuning.textViewMaxRows,
            textViewSampleRows: tuning.textViewSampleRows,
            autosizeSampleRows: tuning.autosizeSampleRows,
            gridMaxColumnWidthPx: tuning.gridMaxColumnWidthPx,
        };
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

    private flushPendingRows(): void {
        if (this.rowsFlushTimer !== undefined) {
            clearTimeout(this.rowsFlushTimer);
            this.rowsFlushTimer = undefined;
        }
        if (this.pendingRows.size === 0) {
            return;
        }
        const batch = this.pendingRows;
        this.pendingRows = new Map();
        for (const [resultSetId, entry] of batch) {
            void this.sendNotification(QsRowsAppendedNotification.type, {
                resultSetId,
                newRowCount: entry.newRowCount,
                complete: entry.complete,
            });
        }
    }

    private flushPendingMessages(): void {
        if (this.messagesFlushTimer !== undefined) {
            clearTimeout(this.messagesFlushTimer);
            this.messagesFlushTimer = undefined;
        }
        if (this.pendingMessages.length === 0) {
            return;
        }
        const messages = this.pendingMessages;
        this.pendingMessages = [];
        const startIndex = this.messagesSentCount;
        this.messagesSentCount += messages.length;
        void this.sendNotification(QsMessagesAppendedNotification.type, { startIndex, messages });
        this.queueStatePush();
    }

    private queueStatePush(): void {
        const now = Date.now();
        const wait = Math.max(0, STATE_PUSH_MIN_INTERVAL_MS - (now - this.lastStatePush));
        if (this.statePushTimer) {
            return;
        }
        this.statePushTimer = setTimeout(() => {
            this.statePushTimer = undefined;
            if (this.isDisposed) {
                return;
            }
            this.lastStatePush = Date.now();
            const next = this.currentState();
            this.state = next;
            void this.sendNotification(QsStateChangedNotification.type, next);
        }, wait);
        this.statePushTimer.unref?.();
    }

    /**
     * Query Studio is pure local content (VEC-5 P0): platform-enforced
     * zero-external-network CSP. allowWorker permits fetching this webview's
     * own bundled worker resources before converting them to blob: workers.
     * Validated live by the vector perf scenarios (full boot + query +
     * pane activation under this policy).
     */
    protected override cspOptions(): { enabled: boolean; allowWorker?: boolean } {
        return { enabled: true, allowWorker: true };
    }

    private vectorWorkbench(): VectorWorkbenchService {
        if (!this.vectorService) {
            // The RUN's resolved tuning wins (budget attribution matches the
            // data being analyzed); config-resolved is the pre-run fallback.
            this.vectorService = new VectorWorkbenchService(
                () => (this.model.executionHost.currentTuning ?? resolveQueryTuning()).params,
            );
        }
        return this.vectorService;
    }

    private spatialResults(): SpatialSessionManager {
        this.spatialService ??= new SpatialSessionManager();
        return this.spatialService;
    }

    private resetSpatialServices(): void {
        this.spatialService?.dispose();
        this.spatialService = undefined;
    }

    private resetVectorServices(): void {
        this.vectorSessionEpoch++;
        this.vectorSearchService?.dispose();
        this.vectorSearchService = undefined;
        this.vectorPipelineService?.dispose();
        this.vectorPipelineService = undefined;
        this.vectorService?.dispose();
        this.vectorService = undefined;
        // Replace rather than reset: a disposed service can still settle an
        // already-issued SQL statement. It must only update the unreachable
        // counter from its old query generation.
        this.vectorPipelineModelStatements = new VectorModelStatementCounter();
        this.vectorSearchModelStatements = new VectorModelStatementCounter();
    }

    /** Revoke host resources while retaining bounded terminal Vector metadata. */
    private suspendVectorServices(): void {
        const hadHostResources = Boolean(this.vectorService || this.vectorPipelineService);
        void this.vectorSearchService?.suspendSensitiveState().catch(() => undefined);
        void this.vectorPipelineService?.suspendSensitiveState().catch(() => undefined);
        this.vectorService?.dispose();
        this.vectorService = undefined;
        if (hadHostResources) {
            this.vectorSessionEpoch++;
        }
    }

    /** Pipeline workspace (VEC-10) — lazy; model calls need host-minted consent. */
    private vectorPipelineService: VectorPipelineService | undefined;

    private vectorPipeline(): VectorPipelineService {
        if (!this.vectorPipelineService) {
            this.vectorPipelineService = new VectorPipelineService({
                auxModelSession: () =>
                    this.model.sessionBinding.acquireAuxiliarySession("vectorModelCall"),
                capabilities: (refresh) =>
                    this.model.vectorCapabilities.capabilities(refresh === true),
                workbench: (handle) => this.vectorWorkbench().sessionFacts(handle),
                modelStatements: this.vectorPipelineModelStatements,
            });
        }
        return this.vectorPipelineService;
    }

    /** Search workspace (VEC-8) — live-only and catalog-authoritative. */
    private vectorSearchService: VectorSearchService | undefined;

    private vectorSearch(): VectorSearchService {
        if (!this.vectorSearchService) {
            this.vectorSearchService = new VectorSearchService({
                auxSession: () =>
                    this.model.sessionBinding.acquireAuxiliarySession("vectorDiagnostics"),
                auxModelSession: () =>
                    this.model.sessionBinding.acquireAuxiliarySession("vectorModelCall"),
                capabilities: (refresh, table) =>
                    this.model.vectorCapabilities.capabilities(refresh === true, table),
                workbench: (handle) => this.vectorWorkbench().sessionFacts(handle),
                modelStatements: this.vectorSearchModelStatements,
            });
        }
        return this.vectorSearchService;
    }

    private registerHandlers(): void {
        // --- panel-local view state -----------------------------------------
        this.onRequest(QsGetPanelViewStateRequest.type, async () => this.panelViewState);
        this.onNotification(QsUpdatePanelViewStateNotification.type, (next) => {
            // Ignore stale renderer callbacks after a rerun. Payload contents
            // remain memory-only and never enter diagnostics/replay/telemetry.
            const normalized = normalizeQueryStudioPanelViewState(
                next,
                this.panelViewState.generation,
            );
            if (normalized) {
                this.panelViewState = normalized;
            }
        });

        // --- text sync -----------------------------------------------------
        this.onRequest(QsSyncEditsRequest.type, async (edits) =>
            this.model.applyWebviewEdits(edits),
        );
        this.onRequest(QsShowCommandPaletteRequest.type, async () => {
            this.restoreEditorFocusWhenActive = true;
            await vscode.commands.executeCommand("workbench.action.showCommands");
        });
        this.onRequest(QsSyncAdoptRequest.type, async ({ text, editGroupId }) =>
            this.model.adoptWebviewText(text, editGroupId),
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
                this.scheduleOpenScan();
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
            const config = vscode.workspace.getConfiguration();
            const timeoutMs = executionTimeoutMs(
                readQuerySessionOptions((key, fallback) => config.get(key, fallback)),
            );
            await this.model.sessionBinding.waitForUserSessionReady();
            const outcome = this.model.executionHost.execute(text, {
                selectionStartLine,
                scope,
                mode,
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
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
            // Azure SQL DB has no USE — switch by reconnecting with the new
            // database (STS v1 ChangeConnectionDatabaseContext IsCloud
            // parity). Everything else keeps the in-session USE. Outcome is
            // journaled and failures return a reason — a selector pick must
            // never no-op silently (dogfood 2026-07-11: NaN engine edition
            // sent Azure down the USE path and the error vanished).
            const azure = this.model.sessionBinding.isAzureSqlDb;
            const method = azure ? "reconnect" : "use";
            const started = Date.now();
            const changed = azure
                ? await this.model.sessionBinding.switchDatabaseByReconnect(database)
                : await this.model.executionHost.setDatabase(database);
            diag.emit({
                feature: "queryStudio",
                type: "queryStudio.dbSwitch",
                status: changed ? "ok" : "error",
                fields: {
                    method: { raw: method, cls: "diagnostic.metadata" },
                    changed: { raw: changed, cls: "diagnostic.metadata" },
                    engineEditionKnown: {
                        raw: this.model.sessionBinding.connectionState.engineEdition !== undefined,
                        cls: "diagnostic.metadata",
                    },
                    ms: { raw: Date.now() - started, cls: "diagnostic.metadata" },
                },
            });
            this.queueStatePush();
            return {
                changed,
                ...(changed
                    ? {}
                    : {
                          reason:
                              method === "reconnect"
                                  ? `Could not reconnect to database "${database}".`
                                  : `Could not switch to database "${database}" (USE failed).`,
                      }),
            };
        });
        this.onRequest(QsListDatabasesRequest.type, async () => {
            const databases = await this.model.executionHost.listDatabases();
            this._languageDatabasesCache = databases;
            return { databases };
        });
        this.onRequest(QsGetRowsRequest.type, async (params) =>
            this.model.executionHost.getRows(
                params.resultSetId,
                params.start,
                params.count,
                "grid",
                params.columnStart !== undefined && params.columnCount !== undefined
                    ? { start: params.columnStart, count: params.columnCount }
                    : undefined,
            ),
        );
        this.onRequest(QsSaveResultRequest.type, async ({ resultSetId, format, selection }) => {
            const summary = this.model.executionHost
                .resultsState()
                .resultSets.find((set) => set.resultSetId === resultSetId);
            if (!summary) {
                return { saved: false, error: "Result set not found." };
            }
            return saveQueryStudioResult({
                sourceUri: this.model.backingDocument.uri,
                summary,
                format,
                selection,
                getRows: (id, start, count) =>
                    this.model.executionHost.getRows(id, start, count, "export"),
            });
        });
        this.onRequest(
            QsOpenCellDocumentRequest.type,
            async ({ resultSetId, row, column, format }) => {
                // Classic openFileThroughLink parity: fetch the single cell,
                // pretty-print, open Beside. {opened:false} on any failure.
                // format "text" = display-clamped huge cell: raw text, no
                // pretty-print, plaintext language.
                try {
                    const window = await this.model.executionHost.getRows(
                        resultSetId,
                        row,
                        1,
                        "cellDocument",
                    );
                    const value = window.values[0]?.[column];
                    if (value === undefined || value === null) {
                        return { opened: false };
                    }
                    const raw = cellDocumentText(value);
                    // Raw-first over the format limit (QO-8): pretty-printing
                    // a multi-megabyte XML/JSON cell synchronously can freeze
                    // the host — above the tuning bound, open the raw text
                    // (still language-highlighted; the user can format
                    // on demand with the editor's Format Document).
                    const formatLimit = (
                        this.model.executionHost.currentTuning ?? resolveQueryTuning()
                    ).params.cellDocumentFormatLimit;
                    const content =
                        format === "text" || raw.length > formatLimit
                            ? raw
                            : prettyPrintCellText(raw, format);
                    const doc = await vscode.workspace.openTextDocument({
                        language: format === "text" ? "plaintext" : format,
                        content,
                    });
                    await vscode.window.showTextDocument(doc, {
                        preview: true,
                        viewColumn: vscode.ViewColumn.Beside,
                    });
                    return { opened: true };
                } catch {
                    return { opened: false };
                }
            },
        );
        this.onRequest(QsOpenPlanRequest.type, async ({ resultSetId }) => {
            // "Open in New Tab": reuse the classic execution-plan viewer.
            try {
                const planXml = await this.planXmlForResultSet(resultSetId);
                if (!planXml) {
                    return { opened: false };
                }
                const seam = await this.executionPlanSeam();
                if (!seam) {
                    return { opened: false };
                }
                openExecutionPlanWebview(
                    seam.context ?? this.extensionContext,
                    seam.executionPlanService,
                    seam.sqlDocumentService,
                    planXml,
                    `${this.model.backingDocument?.uri.path.split("/").pop() ?? "Query Studio"} plan`,
                );
                return { opened: true };
            } catch {
                return { opened: false };
            }
        });
        this.onRequest(QsGetPlanStateRequest.type, async ({ resultSetIds }) => {
            try {
                const xmlPlans = (
                    await Promise.all(resultSetIds.map((id) => this.planXmlForResultSet(id)))
                ).filter((xml): xml is string => xml !== undefined);
                if (xmlPlans.length === 0) {
                    return { error: "No execution plan results are available yet." };
                }
                // Plan-graph parse cache (QO-8): keyed by plan XML content —
                // tab switches and state pushes must not reparse. One entry
                // suffices (plans belong to the current run; a new run's XML
                // differs and replaces it).
                const startedAt = performance.now();
                const cacheKey = `${resultSetIds.join(",")}|${xmlPlans.reduce(
                    (total, xml) => total + xml.length,
                    0,
                )}|${xmlPlans[0]?.slice(0, 256) ?? ""}`;
                if (this.planStateCache?.key === cacheKey) {
                    Perf.marker("mssql.queryStudio.plan.parse", "instant", {
                        plans: xmlPlans.length,
                        cacheHit: true,
                        ms: 0,
                    });
                    return { executionPlanState: this.planStateCache.state };
                }
                const seam = await this.executionPlanSeam();
                if (!seam) {
                    return { error: "Execution plan service is unavailable." };
                }
                const state: ExecutionPlanWebviewState = {
                    executionPlanState: {
                        loadState: ApiStatus.Loading,
                        executionPlanGraphs: [],
                        totalCost: 0,
                    },
                };
                const result = await createExecutionPlanGraphs(
                    state,
                    seam.executionPlanService,
                    xmlPlans,
                    "QueryResults",
                );
                this.planStateCache = { key: cacheKey, state: result.executionPlanState };
                Perf.marker("mssql.queryStudio.plan.parse", "instant", {
                    plans: xmlPlans.length,
                    cacheHit: false,
                    ms: Math.round((performance.now() - startedAt) * 100) / 100,
                });
                return { executionPlanState: result.executionPlanState };
            } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
        });
        this.onRequest(QsSaveExecutionPlanRequest.type, async ({ sqlPlanContent }) => {
            const state: ExecutionPlanWebviewState = {
                executionPlanState: { executionPlanGraphs: [], totalCost: 0 },
            };
            await saveExecutionPlan(state, { sqlPlanContent });
        });
        this.onRequest(QsShowPlanXmlRequest.type, async ({ sqlPlanContent }) => {
            const state: ExecutionPlanWebviewState = {
                executionPlanState: { executionPlanGraphs: [], totalCost: 0 },
            };
            await showPlanXml(state, { sqlPlanContent });
        });

        // --- spatial results: lazy, opaque, bounded pull sessions -----------
        this.onRequest(QsSpatialOpenRequest.type, async (params) =>
            this.spatialResults().open(this.model.executionHost.retainedStore, params),
        );
        this.onRequest(QsSpatialNextRequest.type, async (params) =>
            this.spatialResults().next(params),
        );
        this.onRequest(QsSpatialCancelRequest.type, async ({ handle, generation }) => {
            this.spatialService?.cancel(handle, generation);
        });
        this.onRequest(QsSpatialCloseRequest.type, async ({ handle }) => {
            this.spatialService?.close(handle);
        });

        // --- vector workbench (VEC-4): opaque pull sessions -----------------
        // The service is created lazily on the first vector RPC — a document
        // that never opens the Vector tab pays nothing here.
        this.onRequest(QsVectorOpenRequest.type, async (params) =>
            this.vectorWorkbench().open(this.model.executionHost.retainedStore, params),
        );
        this.onRequest(QsVectorProfileRequest.type, async ({ handle }) =>
            this.vectorWorkbench().profile(handle),
        );
        this.onRequest(QsVectorFindingDetailRequest.type, async ({ handle, kind }) =>
            this.vectorWorkbench().findingDetail(handle, kind),
        );
        this.onRequest(QsVectorCancelRequest.type, async ({ handle }) => {
            this.vectorService?.cancel(handle);
        });
        this.onRequest(QsVectorCloseRequest.type, async ({ handle }) => {
            // A late cleanup from a renderer invalidated by rerun/hide must
            // not recreate an otherwise-empty analysis service.
            this.vectorService?.close(handle);
        });
        this.onRequest(QsVectorCapabilitiesRequest.type, async (params) =>
            this.model.vectorCapabilities.capabilities(
                (params as { refresh?: boolean } | undefined)?.refresh === true,
            ),
        );
        this.onRequest(QsVectorProjectionRequest.type, async ({ handle }) =>
            this.vectorWorkbench().projection(handle),
        );
        this.onRequest(QsVectorCompareRequest.type, async ({ handle, ordinals }) =>
            this.vectorWorkbench().compare(handle, ordinals),
        );
        this.onRequest(QsVectorSearchTargetsRequest.type, async ({ handle }) =>
            this.vectorSearch().searchTargets(handle),
        );
        this.onRequest(QsVectorSearchModelsRequest.type, async ({ handle, refresh }) =>
            this.vectorSearch().searchModels(handle, refresh === true),
        );
        this.onRequest(QsVectorSearchModelPrepareRequest.type, async (params) =>
            this.vectorSearch().searchModelPrepare(params),
        );
        this.onRequest(QsVectorSearchModelExecuteRequest.type, async ({ handle, token }) =>
            this.vectorSearch().searchModelExecute(handle, token),
        );
        this.onRequest(QsVectorSearchRequest.type, async (params) =>
            this.vectorSearch().search(params),
        );
        this.onRequest(
            QsVectorSearchResultRequest.type,
            async ({ handle, runId, targetId }) =>
                this.vectorSearchService?.restoreResult(handle, runId, targetId) ?? {
                    generation: 0,
                    error: "The cached search result is unavailable.",
                },
        );
        this.onRequest(QsVectorSearchCancelRequest.type, async ({ handle, sensitive }) => {
            if (sensitive) {
                await this.vectorSearchService?.suspendSensitiveState(handle);
            } else {
                await this.vectorSearchService?.cancel(handle);
            }
        });
        this.onRequest(QsVectorIndexStateRequest.type, async (params) => {
            const search = this.vectorSearch();
            let target = search.indexTargetFacts(
                params?.targetId,
                params?.metric,
                params?.filterColumns,
            );
            if (!target && params?.targetId && params.handle) {
                const discovery = await search.searchTargets(params.handle);
                if (discovery.error) {
                    return { error: discovery.error };
                }
                target = search.indexTargetFacts(
                    params.targetId,
                    params.metric,
                    params.filterColumns,
                );
            }
            if (!target) {
                return {
                    error: "Choose a catalog-verified base-table target before inspecting its vector index.",
                };
            }
            return new VectorIndexService(
                (refresh, table) =>
                    this.model.vectorCapabilities.capabilities(refresh === true, table),
                () => target,
            ).indexState(params?.refresh === true);
        });
        this.onRequest(QsVectorPipelineStateRequest.type, async (params) =>
            this.vectorPipeline().pipelineState(
                (params as { refresh?: boolean } | undefined)?.refresh === true,
            ),
        );
        this.onRequest(QsVectorReembedPrepareRequest.type, async (params) =>
            this.vectorPipeline().reembedPrepare(params),
        );
        this.onRequest(QsVectorReembedExecuteRequest.type, async ({ handle, token }) =>
            this.vectorPipeline().reembedExecute(handle, token),
        );
        this.onRequest(QsVectorReembedResultRequest.type, async ({ handle, runId }) =>
            this.vectorPipeline().reembedResult(handle, runId),
        );
        this.onRequest(QsVectorPipelineCancelRequest.type, async ({ handle }) => {
            await this.vectorPipelineService?.cancel(handle);
        });
        this.onRequest(QsVectorChunkPreviewRequest.type, async (params) =>
            this.vectorPipeline().chunkPreview(params),
        );
        this.onRequest(QsShowPlanQueryRequest.type, async ({ query }) => {
            const seam = await this.executionPlanSeam();
            if (!seam) {
                return;
            }
            const state: ExecutionPlanWebviewState = {
                executionPlanState: { executionPlanGraphs: [], totalCost: 0 },
            };
            await showQuery(
                state,
                { query },
                seam.sqlDocumentService,
                this.model.backingDocument.uri.toString(),
            );
        });
        this.onRequest(QsGetMessagesRequest.type, async (params) =>
            this.model.executionHost.getMessages(params?.afterIndex),
        );
        this.onRequest(QsGetMessagesTextRequest.type, async () => ({
            text: buildMessagesText(this.model.executionHost.getMessages().messages),
        }));
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
        this.onRequest(QsSetSqlcmdModeRequest.type, async ({ enabled }) => {
            this.setSqlcmdMode(enabled, "user");
        });
        this.onRequest(QsInlineCompletionRequest.type, async (params) => {
            // Same provider pipeline as the classic editor — the custom text
            // editor's backing vscode.TextDocument stays sync'd by the host.
            // Bridge span: webview RPC arrival -> provider result (<=10ms
            // overhead target over the bare provider call; surface attr
            // distinguishes this from classic-editor requests).
            const bridgeSpan = diag.startSpan({
                feature: "queryStudio",
                kind: "span",
                type: "queryStudio.inlineCompletion.bridge",
                fields: {
                    surface: { raw: "queryStudio", cls: "diagnostic.metadata" },
                    trigger: { raw: params.trigger, cls: "diagnostic.metadata" },
                },
            });
            const endBridge = (returned: boolean) =>
                bridgeSpan.end("ok", {
                    returned: { raw: returned, cls: "diagnostic.metadata" },
                });
            const provider = getSharedInlineCompletionProvider();
            const document = this.model.backingDocument;
            if (!provider || !document) {
                endBridge(false);
                return { text: "" };
            }
            this.inlineCompletionCts?.cancel();
            const cts = new vscode.CancellationTokenSource();
            this.inlineCompletionCts = cts;
            try {
                if (params.textHash !== undefined) {
                    await this.model.awaitTextHash(params.textHash, 200);
                    if (cts.token.isCancellationRequested) {
                        endBridge(false);
                        return { text: "" };
                    }
                }
                const items = await provider.provideInlineCompletionItems(
                    document,
                    new vscode.Position(params.line, params.character),
                    {
                        triggerKind:
                            params.trigger === "invoke"
                                ? vscode.InlineCompletionTriggerKind.Invoke
                                : vscode.InlineCompletionTriggerKind.Automatic,
                        selectedCompletionInfo: undefined,
                    },
                    cts.token,
                );
                const list = Array.isArray(items) ? items : (items?.items ?? []);
                const item = list[0];
                if (!item) {
                    endBridge(false);
                    return { text: "" };
                }
                const text =
                    typeof item.insertText === "string" ? item.insertText : item.insertText.value;
                const commandArgs = item.command?.arguments ?? [];
                const eventId = typeof commandArgs[1] === "string" ? commandArgs[1] : undefined;
                if (item.command) {
                    this.inlineCompletionAcceptedArgs.set(eventId ?? "__last__", commandArgs);
                }
                endBridge(text.length > 0);
                return { text, ...(eventId ? { eventId } : {}) };
            } catch {
                endBridge(false);
                return { text: "" };
            } finally {
                if (this.inlineCompletionCts === cts) {
                    this.inlineCompletionCts = undefined;
                }
            }
        });
        this.onRequest(QsInlineCompletionAcceptedRequest.type, async ({ eventId }) => {
            const commandArgs = this.inlineCompletionAcceptedArgs.get(eventId ?? "__last__");
            if (commandArgs) {
                this.inlineCompletionAcceptedArgs.delete(eventId ?? "__last__");
                await vscode.commands.executeCommand(
                    "mssql.copilot.inlineCompletion.accepted",
                    ...commandArgs,
                );
            }
        });
        this.onRequest(QsUpdateGridSelectionRequest.type, async (update) => {
            // Active-result context (C2D-4): selection shape only, values
            // never ride this channel.
            getQueryResultContextService().updateFromQueryStudio(
                this.model.liveResultSource.sourceId,
                update,
            );
        });
        this.onRequest(QsPinResultSetRequest.type, async ({ resultSetId }) =>
            this.pinResults({ kind: "resultSet", resultSetId }),
        );
        this.onRequest(QsPinAllResultsRequest.type, async () =>
            this.pinResults({ kind: "allCompleteResultSets" }),
        );

        // --- language features (LS-0): 1:1 onto the per-document facade ------
        this.onRequest(QsLangCompletionRequest.type, async (params) => {
            const result = await this.languageService.completion(
                { line: params.line, character: params.character },
                params.trigger,
                params.triggerCharacter,
                params.textHash,
                params.text,
            );
            return result ?? { items: [], isIncomplete: false };
        });
        this.onRequest(
            QsLangHoverRequest.type,
            async (position) =>
                (await this.languageService.hover(position, position.textHash)) ?? null,
        );
        this.onRequest(
            QsLangSignatureHelpRequest.type,
            async (position) =>
                (await this.languageService.signatureHelp(position, position.textHash)) ?? null,
        );
        this.onRequest(QsLangDefinitionRequest.type, async (position) => {
            const result = await this.languageService.definition(position, position.textHash);
            if (result?.range) {
                return { range: result.range };
            }
            // Scripted target (LS-4): open the generated script BESIDE as a
            // read-only mssql-def: document at the anchor (design §13.5);
            // the webview keeps its in-editor navigation for ranges only.
            if (result?.virtualContent !== undefined) {
                const provider = definitionContentProvider();
                if (provider !== undefined) {
                    await openScriptedDefinition(provider, result.virtualContent);
                }
            }
            return null;
        });
        this.onRequest(QsLangFoldingRequest.type, async () => ({
            ranges: (await this.languageService.folding()) ?? [],
        }));
        this.onRequest(QsLangDocumentSymbolsRequest.type, async () => ({
            symbols: (await this.languageService.documentSymbols()) ?? [],
        }));
        this.onRequest(QsLangDiagnosticsRequest.type, async () => ({
            diagnostics: (await this.languageService.diagnostics())?.diagnostics ?? [],
        }));
        this.onRequest(QsLangStatusRequest.type, async () => {
            const status = this.languageService.status();
            return {
                preference: status.preference,
                features: status.router.map((entry) => ({
                    feature: entry.feature,
                    maturity: entry.maturity,
                    effectiveEngine: entry.effectiveEngine,
                    circuitBroken: entry.circuitBroken,
                })),
                readiness: { ...status.readiness },
                metadataGeneration: status.metadataGeneration,
                shadowConnectionState: status.shadowConnectionState,
            };
        });
    }

    /** Status snapshot for the languageServiceStatus command (editor provider). */
    public get languageServiceStatus(): LanguageServiceStatus {
        return this.languageService.status();
    }

    public get documentUriKey(): string {
        return this.model.uriKey;
    }

    public revealEditorPosition(line: number, column: number): void {
        this.panel.reveal(undefined, false);
        void this.sendNotification(QsRevealPositionNotification.type, {
            line,
            column,
            flash: true,
        });
    }

    public override dispose(): void {
        if (this.statePushTimer) {
            clearTimeout(this.statePushTimer);
        }
        if (this.rowsFlushTimer) {
            clearTimeout(this.rowsFlushTimer);
        }
        if (this.messagesFlushTimer) {
            clearTimeout(this.messagesFlushTimer);
        }
        this.inlineCompletionCts?.cancel();
        this.inlineCompletionCts = undefined;
        this.resetVectorServices();
        this.resetSpatialServices();
        this.languageService.dispose();
        this.modelListener.dispose();
        this.bindingListener?.dispose();
        this.executionListener?.dispose();
        super.dispose();
    }
}
