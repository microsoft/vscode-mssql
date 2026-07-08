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
    QsGridStyle,
    QsOpenCellDocumentRequest,
    QsOpenPlanRequest,
    QsInlineCompletionAcceptedRequest,
    QsInlineCompletionRequest,
    QsListDatabasesRequest,
    QsNavigateToLineRequest,
    QsReconnectRequest,
    QsRestoreEditorFocusNotification,
    QsRunStartedNotification,
    QsSaveResultRequest,
    QsSetActualPlanRequest,
    QsSetDatabaseRequest,
    QsSetViewModeRequest,
    QsState,
    QsStateChangedNotification,
    QsShowCommandPaletteRequest,
    QsSyncAdoptRequest,
    QsSyncEditsRequest,
    QsSyncInitNotification,
    QsSyncRemoteNotification,
    QsSyncResyncNotification,
    QsSyncResyncRequest,
    QsSyncSaveRequest,
    QsSyncUndoRequest,
    QsUpdateGridSelectionRequest,
} from "../sharedInterfaces/queryStudio";
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
import { definitionContentProvider, openScriptedDefinition } from "./definitionContentProvider";
import { QueryStudioDocumentModel } from "./queryStudioDocumentModel";
import {
    DIAGNOSTICS_ENABLED_SETTING,
    LANGUAGE_ENGINE_SETTING,
    LanguageServiceStatus,
    QueryStudioLanguageService,
} from "./queryStudioLanguageService";
import { cellDocumentText, prettyPrintCellText } from "./cellDocument";
import { openExecutionPlanWebview } from "../controllers/sharedExecutionPlanUtils";
import { readGridStyle } from "./gridStyle";
import { executionTimeoutMs, readQuerySessionOptions } from "./sessionOptions";
import { saveQueryStudioResult } from "./resultExport";

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
    private inlineCompletionCts: vscode.CancellationTokenSource | undefined;
    /** Accepted-command args by debug event id ("__last__" when capture is off). */
    private inlineCompletionAcceptedArgs = new Map<string, unknown[]>();
    private readonly languageService: QueryStudioLanguageService;
    /** Database names cached from QsListDatabases for USE completions. */
    private _languageDatabasesCache: string[] | undefined;
    private restoreEditorFocusWhenActive = false;

    private readonly extensionContext: vscode.ExtensionContext;

    constructor(
        context: vscode.ExtensionContext,
        private readonly panel: vscode.WebviewPanel,
        private readonly model: QueryStudioDocumentModel,
    ) {
        super(context, "queryStudio", QueryStudioController.initialState(model), "queryStudio");
        this.extensionContext = context;
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
                    e.affectsConfiguration("mssql.resultsGrid")
                ) {
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

        this.bindingListener = this.model.sessionBinding.onDidChange(() => this.queueStatePush());

        this.executionListener = this.model.executionHost.attach({
            onRunStarted: (startedEpochMs) => {
                void this.sendNotification(QsRunStartedNotification.type, { startedEpochMs });
                this.queueStatePush();
            },
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
            gridStyle: QueryStudioController.currentGridStyle(),
            statusMessage: { kind: "ready", text: "Ready — not connected" },
            capabilities: {},
        };
    }

    /** Grid styling snapshot from live configuration (classic parity). */
    private static currentGridStyle(): QsGridStyle {
        const config = vscode.workspace.getConfiguration();
        return readGridStyle((key) => config.get(key));
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
        const metadata = this.model.sessionBinding.metadataStatus;
        if (metadata) {
            state.metadata = {
                readiness: metadata.readiness,
                generation: metadata.generation,
                mode: metadata.mode,
            };
        }
        state.completions = { enabled: isInlineCompletionFeatureEnabled() };
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

    private registerHandlers(): void {
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
            const changed = await this.model.executionHost.setDatabase(database);
            this.queueStatePush();
            return { changed };
        });
        this.onRequest(QsListDatabasesRequest.type, async () => {
            const databases = await this.model.executionHost.listDatabases();
            this._languageDatabasesCache = databases;
            return { databases };
        });
        this.onRequest(QsGetRowsRequest.type, async (params) =>
            this.model.executionHost.getRows(params.resultSetId, params.start, params.count),
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
                getRows: (id, start, count) => this.model.executionHost.getRows(id, start, count),
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
                    const window = this.model.executionHost.getRows(resultSetId, row, 1);
                    const value = window.values[0]?.[column];
                    if (value === undefined || value === null) {
                        return { opened: false };
                    }
                    const raw = cellDocumentText(value);
                    const content = format === "text" ? raw : prettyPrintCellText(raw, format);
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
            // QS-1: reuse the classic execution-plan viewer — fetch the
            // canonical single-cell showplan XML and hand it to the existing
            // webview (plan PARSING rides the same STS v1 service classic
            // uses; this is viewer reuse, not a data-plane dependency).
            try {
                const summary = this.model.executionHost
                    .resultsState()
                    .resultSets.find((set) => set.resultSetId === resultSetId);
                if (!summary?.isPlanResult) {
                    return { opened: false };
                }
                const window = this.model.executionHost.getRows(resultSetId, 0, 1);
                const value = window.values[0]?.[0];
                if (value === undefined || value === null) {
                    return { opened: false };
                }
                const seam = (await vscode.commands.executeCommand(
                    "mssql.getControllerForTests",
                )) as
                    | {
                          context?: vscode.ExtensionContext;
                          executionPlanService?: unknown;
                          sqlDocumentService?: unknown;
                      }
                    | undefined;
                if (!seam?.executionPlanService || !seam.sqlDocumentService) {
                    return { opened: false };
                }
                openExecutionPlanWebview(
                    seam.context ?? this.extensionContext,
                    seam.executionPlanService as never,
                    seam.sqlDocumentService as never,
                    cellDocumentText(value),
                    `${this.model.backingDocument?.uri.path.split("/").pop() ?? "Query Studio"} plan`,
                );
                return { opened: true };
            } catch {
                return { opened: false };
            }
        });
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
        this.onRequest(QsUpdateGridSelectionRequest.type, async () => undefined);

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
        this.inlineCompletionCts?.cancel();
        this.inlineCompletionCts = undefined;
        this.languageService.dispose();
        this.modelListener.dispose();
        this.bindingListener?.dispose();
        this.executionListener?.dispose();
        super.dispose();
    }
}
