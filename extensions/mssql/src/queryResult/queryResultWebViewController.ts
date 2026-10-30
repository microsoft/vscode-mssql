/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
import * as mr from "../sharedInterfaces/multiResults";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { WebviewViewController } from "../controllers/webviewViewController";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { randomUUID } from "crypto";
import { ApiStatus } from "../sharedInterfaces/webview";
import SqlDocumentService from "../controllers/sqlDocumentService";
import { ExecutionPlanService } from "../services/executionPlanService";
import { QueryResultWebviewPanelController } from "./queryResultWebviewPanelController";
import {
    countResultSets,
    getNewResultPaneViewColumn,
    getInMemoryGridDataProcessingThreshold,
    messageToString,
    recordLength,
    registerCommonRequestHandlers,
} from "./utils";
import { Deferred } from "../protocol";
import { getUriKey } from "../utils/utils";
import { getPreviewConfigKey, PreviewFeature, previewService } from "../previews/previewService";
import { getQueryResultWebviewSource } from "./queryResultWebviewSource";
import { MultiResultsLayout } from "./multiResultsLayout";
import store from "./singletonStore";

const QUERY_RESULT_VIEW_ID = "queryResult";

export class QueryResultWebviewController extends WebviewViewController<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
> {
    private _queryResultStateMap: Map<string, qr.QueryResultWebviewState> = new Map<
        string,
        qr.QueryResultWebviewState
    >();
    private _queryResultWebviewPanelControllerMap: Map<string, QueryResultWebviewPanelController> =
        new Map<string, QueryResultWebviewPanelController>();
    private _selectionSummaryContinuations: Map<string, Deferred<void>> = new Map();
    private _correlationId: string = randomUUID();
    /**
     * Set while the results grid mode is being changed by the in-product switch, which reports
     * its own telemetry. The configuration listener below fires for that write as well, so this
     * keeps a single toggle from being counted twice.
     */
    private _gridModeChangeReportedBySwitch: boolean = false;
    /**
     * Editor status bar item used to show the grid selection summary when the query results
     * footer preview is disabled. When the footer preview is enabled, the selection summary is
     * shown inside the results view footer instead and this item stays hidden.
     */
    private _selectionSummaryStatusBarItem: vscode.StatusBarItem =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
    public actualPlanStatuses: string[] = [];
    private _sqlDocumentService: SqlDocumentService;
    /**
     * Set while the multi-results preview is enabled. The view then lists every result that is
     * not open in its own tab and shows one group of them at a time.
     */
    private _multiResultsLayout: MultiResultsLayout | undefined;
    /** Results whose editor has closed. They stay in the list until the user closes them. */
    private _closedDocumentUris: Set<string> = new Set();
    /** The entries last sent to the view, to skip sending the layout when nothing changed. */
    private _multiResultsEntries: Map<string, mr.MultiResultsEntry> = new Map();

    constructor(
        context: vscode.ExtensionContext,
        private _executionPlanService: ExecutionPlanService,
        private _sqlOutputContentProvider: SqlOutputContentProvider,
    ) {
        const isBetaResultsGridEnabled = previewService.isFeatureEnabled(
            PreviewFeature.BetaResultsGrid,
        );
        super(
            context,
            getQueryResultWebviewSource(isBetaResultsGridEnabled),
            QUERY_RESULT_VIEW_ID,
            {
                resultSetSummaries: {},
                messages: [],
                tabStates: {
                    resultPaneTab: qr.QueryResultPaneTabs.Messages,
                },
                executionPlanState: {},
                fontSettings: {},
                gridSettings: {},
                autoSizeColumnsMode: qr.ResultsGridAutoSizeStyle.HeadersAndData,
                isExecuting: false,
                executionElapsedMilliseconds: undefined,
                rowsAffected: undefined,
                isBetaResultsGridEnabled,
            },
        );

        void this.initialize();

        context.subscriptions.push(this._selectionSummaryStatusBarItem);

        // not the best api but it's the best we can do in VSCode
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                const uri = getUriKey(document.uri);
                if (this._sqlDocumentService?.isUriBeingRenamedOrSaved(uri)) {
                    return;
                }
                if (this.isInMultiResultsList(uri)) {
                    this._closedDocumentUris.add(uri);
                    this.refreshMultiResultsEntry(uri);
                    return;
                }
                if (this._queryResultStateMap.has(uri)) {
                    this._queryResultStateMap.delete(uri);
                }
            }),
            vscode.workspace.onDidOpenTextDocument((document) => {
                const uri = getUriKey(document.uri);
                if (this._closedDocumentUris.delete(uri)) {
                    this.refreshMultiResultsEntry(uri);
                }
            }),
        );

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                let stateChanged = false;
                if (e.affectsConfiguration("mssql.resultsFontFamily")) {
                    const newValue = this.getFontFamilyConfig();
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.fontSettings.fontFamily = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    stateChanged = true;
                }
                if (e.affectsConfiguration("mssql.resultsFontSize")) {
                    const newValue = this.getFontSizeConfig();
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.fontSettings.fontSize = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    stateChanged = true;
                }
                if (e.affectsConfiguration("mssql.resultsGrid.autoSizeColumnsMode")) {
                    const newValue = this.getAutoSizeColumnsConfig();
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.autoSizeColumnsMode = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    stateChanged = true;
                }
                if (e.affectsConfiguration("mssql.resultsGrid.inMemoryDataProcessingThreshold")) {
                    const newValue = getInMemoryGridDataProcessingThreshold();
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.inMemoryDataProcessingThreshold = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    stateChanged = true;
                }
                if (
                    e.affectsConfiguration(getPreviewConfigKey(PreviewFeature.BetaResultsGrid)) ||
                    e.affectsConfiguration(Constants.configEnableExperimentalFeatures)
                ) {
                    const newValue = this.isBetaResultsGridEnabled;

                    // The in-product switch reports its own richer event, so only report the
                    // changes that came from elsewhere (the Settings UI, settings sync, or a
                    // change to the global experimental features flag).
                    if (this._gridModeChangeReportedBySwitch) {
                        this._gridModeChangeReportedBySwitch = false;
                    } else {
                        sendActionEvent(
                            TelemetryViews.QueryResult,
                            TelemetryActions.ToggleResultsGridMode,
                            {
                                additionalProps: {
                                    correlationId: this._correlationId,
                                    newMode: newValue ? "preview" : "classic",
                                    source: "settings",
                                },
                            },
                        );
                    }

                    for (const [uri, state] of this._queryResultStateMap) {
                        state.isBetaResultsGridEnabled = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    this.reloadWebview(getQueryResultWebviewSource(newValue));
                    for (const controller of this._queryResultWebviewPanelControllerMap.values()) {
                        controller.reloadForResultsGridChange(newValue);
                    }
                    this.updateSelectionSummary();
                    stateChanged = true;
                }
                if (
                    e.affectsConfiguration("mssql.resultsGrid.alternatingRowColors") ||
                    e.affectsConfiguration("mssql.resultsGrid.freezeFirstColumnByDefault") ||
                    e.affectsConfiguration("mssql.resultsGrid.showGridLines") ||
                    e.affectsConfiguration("mssql.resultsGrid.rowPadding") ||
                    e.affectsConfiguration("mssql.resultsGrid.rightAlignNumbers")
                ) {
                    const newValue = this.getGridSettingsConfig();
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.gridSettings = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    stateChanged = true;
                }
                if (
                    e.affectsConfiguration(getPreviewConfigKey(PreviewFeature.MultiResults)) ||
                    e.affectsConfiguration(getPreviewConfigKey(PreviewFeature.BetaResultsGrid)) ||
                    e.affectsConfiguration(Constants.configEnableExperimentalFeatures)
                ) {
                    this.updateMultiResultsActivation();
                }
                if (
                    e.affectsConfiguration(Constants.configQueryResultsFollowActiveEditor) &&
                    this._multiResultsLayout
                ) {
                    const activeUri = getUriKey(vscode.window.activeTextEditor?.document?.uri);
                    if (this.followActiveEditor && activeUri) {
                        this._multiResultsLayout.focus(activeUri);
                    }
                    this.updateMultiResultsView();
                }
                if (stateChanged) {
                    // Push updates to all open panel controllers
                    for (const [uri] of this._queryResultStateMap) {
                        this.updatePanelState(uri);
                    }
                    this.sendMultiResultsActiveGroupStates();
                    // Push update to the webview view if it is visible
                    if (this.isVisible() && this.state?.uri) {
                        const currentUri = this.state.uri;
                        if (this._queryResultStateMap.has(currentUri)) {
                            this.state = this.getQueryResultState(currentUri);
                        }
                    }
                }
                if (
                    e.affectsConfiguration(Constants.configOpenQueryResultsInTabByDefault) &&
                    this.isOpenQueryResultsInTabByDefaultEnabled
                ) {
                    void this.moveCurrentPanelResultToDocumentTab();
                }
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdHandleSummaryOperation, async (uri) => {
                this.handleSelectionSummary(uri);
            }),
            vscode.commands.registerCommand(Constants.cmdEnableFollowActiveEditor, () =>
                this.setFollowActiveEditor(true),
            ),
            vscode.commands.registerCommand(Constants.cmdDisableFollowActiveEditor, () =>
                this.setFollowActiveEditor(false),
            ),
        );

        this.updateMultiResultsActivation();
    }

    public handleSelectionSummary(uri: string): void {
        if (!this._queryResultStateMap.has(uri)) {
            return;
        }
        this._selectionSummaryContinuations.get(uri)?.resolve();
    }

    private get shouldAutoRevealResultsPanel(): boolean {
        return vscode.workspace.getConfiguration().get(Constants.configAutoRevealResultsPanel);
    }

    public updateResultsOnActiveEditorChange(editor: vscode.TextEditor | undefined): void {
        this.updateSelectionSummary();

        if (this._multiResultsLayout) {
            this.followEditorInMultiResults(editor);
            return;
        }

        const uri = getUriKey(editor?.document?.uri);
        const hasPanel = uri && this.hasPanel(uri);
        const hasWebviewViewState = uri && this._queryResultStateMap.has(uri);

        if (hasWebviewViewState) {
            if (hasPanel) {
                this.revealPanelForEditor(editor, uri);
                /**
                 * If the results are shown in webview panel, we always set
                 * the webview view to show splash screen.
                 */
                this.showSplashScreen();
            } else {
                this.state = this.getQueryResultState(uri);
            }
        } else {
            this.showSplashScreen();
        }
    }

    /**
     * Reveals the tab showing an editor's results, unless the tab shares the editor's column and
     * would cover it.
     */
    private revealPanelForEditor(editor: vscode.TextEditor | undefined, uri: string): void {
        const editorViewColumn = editor?.viewColumn;
        const panelViewColumn = this._queryResultWebviewPanelControllerMap.get(uri).viewColumn;
        if (this.shouldAutoRevealResultsPanel && editorViewColumn !== panelViewColumn) {
            this.revealPanel(uri);
        }
    }

    /**
     * Shows the active editor's results in the multi-results view when following the active
     * editor. An editor without results in the view leaves the current group showing.
     */
    private followEditorInMultiResults(editor: vscode.TextEditor | undefined): void {
        const uri = getUriKey(editor?.document?.uri);
        if (!uri) {
            return;
        }
        if (this.hasPanel(uri) && this._queryResultStateMap.has(uri)) {
            this.revealPanelForEditor(editor, uri);
            return;
        }
        if (this.followActiveEditor) {
            this.focusMultiResult(uri);
        }
    }

    private async initialize() {
        this.registerRpcHandlers();
    }

    private get isOpenQueryResultsInTabByDefaultEnabled(): boolean {
        return vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configOpenQueryResultsInTabByDefault, false);
    }

    private get isDefaultQueryResultToDocumentDoNotShowPromptEnabled(): boolean {
        return vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configOpenQueryResultsInTabByDefaultDoNotShowPrompt, false);
    }

    private get shouldShowDefaultQueryResultToDocumentPrompt(): boolean {
        return (
            !this.isOpenQueryResultsInTabByDefaultEnabled &&
            !this.isDefaultQueryResultToDocumentDoNotShowPromptEnabled
        );
    }

    /**
     * Suppresses the configuration listener's telemetry for the next results grid mode change,
     * for use by the in-product switch which reports the change itself. Pass `false` to release
     * the suppression if the configuration write ends up failing.
     */
    public setGridModeChangeReportedBySwitch(reported: boolean): void {
        this._gridModeChangeReportedBySwitch = reported;
    }

    private get isBetaResultsGridEnabled(): boolean {
        return previewService.isFeatureEnabled(PreviewFeature.BetaResultsGrid);
    }

    private registerRpcHandlers() {
        this.onRequest(qr.OpenInNewTabRequest.type, async (message) => {
            void this.createPanelController(message.uri);

            if (this.shouldShowDefaultQueryResultToDocumentPrompt) {
                const response = await vscode.window.showInformationMessage(
                    LocalizedConstants.openQueryResultsInTabByDefaultPrompt,
                    LocalizedConstants.alwaysShowInNewTab,
                    LocalizedConstants.keepInQueryPane,
                );
                let telemResponse: string;
                switch (response) {
                    case LocalizedConstants.alwaysShowInNewTab:
                        telemResponse = "alwaysShowInNewTab";
                        break;
                    case LocalizedConstants.keepInQueryPane:
                        telemResponse = "keepInQueryPane";
                        break;
                    default:
                        telemResponse = "dismissed";
                }

                sendActionEvent(
                    TelemetryViews.General,
                    TelemetryActions.OpenQueryResultsInTabByDefaultPrompt,
                    {
                        additionalProps: {
                            response: telemResponse,
                        },
                    },
                );

                if (response === LocalizedConstants.alwaysShowInNewTab) {
                    await vscode.workspace
                        .getConfiguration()
                        .update(
                            Constants.configOpenQueryResultsInTabByDefault,
                            true,
                            vscode.ConfigurationTarget.Global,
                        );
                }
                // show the prompt only once
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configOpenQueryResultsInTabByDefaultDoNotShowPrompt,
                        true,
                        vscode.ConfigurationTarget.Global,
                    );
            }
        });
        this.onRequest(qr.GetWebviewLocationRequest.type, async () => {
            return qr.QueryResultWebviewLocation.Panel;
        });
        registerCommonRequestHandlers(this, this._correlationId);
        this.registerMultiResultsHandlers();
    }

    private registerMultiResultsHandlers() {
        this.onRequest(mr.GetMultiResultsFileStateRequest.type, async ({ uri }) => {
            return this._queryResultStateMap.get(uri);
        });
        this.onRequest(mr.MultiResultsPaneActionRequest.type, async ({ uri, type, payload }) => {
            const state = this._queryResultStateMap.get(uri);
            if (!state) {
                return;
            }
            const nextState = await this.applyReducer(
                type,
                state,
                payload as qr.QueryResultReducers[typeof type],
            );
            this._queryResultStateMap.set(uri, nextState);
            this.sendMultiResultsFileState(uri);
        });
        this.onNotification(mr.FocusMultiResultNotification.type, ({ uri }) => {
            this.focusMultiResult(uri);
        });
        this.onNotification(mr.MoveMultiResultNotification.type, ({ uri, target }) => {
            if (!this._multiResultsLayout?.has(uri)) {
                return;
            }
            this._multiResultsLayout.move(uri, target);
            sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.MoveMultiResult, {
                additionalProps: { target: target.kind },
            });
            this.updateMultiResultsView();
        });
        this.onNotification(mr.CloseMultiResultNotification.type, ({ uri }) => {
            void this.closeMultiResult(uri);
        });
        this.onNotification(mr.SetMultiResultsGroupSizesNotification.type, ({ groupId, sizes }) => {
            this._multiResultsLayout?.setSizes(groupId, sizes);
            this.updateMultiResultsView();
        });
    }

    private showSplashScreen() {
        this.state = this.createEmptyViewState();
    }

    private createEmptyViewState(): qr.QueryResultWebviewState {
        return {
            resultSetSummaries: {},
            messages: [],
            tabStates: undefined,
            isExecutionPlan: false,
            executionPlanState: {},
            isExecuting: false,
            executionElapsedMilliseconds: undefined,
            rowsAffected: undefined,
            fontSettings: {
                fontSize: this.getFontSizeConfig(),
                fontFamily: this.getFontFamilyConfig(),
            },
            gridSettings: this.getGridSettingsConfig(),
            autoSizeColumnsMode: this.getAutoSizeColumnsConfig(),
            inMemoryDataProcessingThreshold: getInMemoryGridDataProcessingThreshold(),
            isBetaResultsGridEnabled: this.isBetaResultsGridEnabled,
            initializationError: undefined,
        };
    }

    private get followActiveEditor(): boolean {
        return vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configQueryResultsFollowActiveEditor, true);
    }

    private async setFollowActiveEditor(follow: boolean): Promise<void> {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.ToggleFollowActiveEditor, {
            additionalProps: { followActiveEditor: String(follow) },
        });
        const config = vscode.workspace.getConfiguration();
        // A workspace value overrides the user value, so change the setting where it is set.
        const target =
            config.inspect<boolean>(Constants.configQueryResultsFollowActiveEditor)
                ?.workspaceValue !== undefined
                ? vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;
        await config.update(Constants.configQueryResultsFollowActiveEditor, follow, target);
    }

    /**
     * The multi-results layout needs the preview grid: each result is shown in a pane of the
     * preview grid's results view.
     */
    private get shouldUseMultiResults(): boolean {
        return previewService.multiResultsEnabled && this.isBetaResultsGridEnabled;
    }

    public get isMultiResultsActive(): boolean {
        return this._multiResultsLayout !== undefined;
    }

    /**
     * Whether the result is listed in the multi-results view, where it stays after its editor
     * closes.
     */
    public isInMultiResultsList(uri: string): boolean {
        return this._multiResultsLayout?.has(uri) ?? false;
    }

    /**
     * Switches the view between the single-result and multi-results layouts to match the
     * preview settings.
     */
    private updateMultiResultsActivation(): void {
        const shouldBeActive = this.shouldUseMultiResults;
        if (shouldBeActive === this.isMultiResultsActive) {
            return;
        }
        void vscode.commands.executeCommand(
            "setContext",
            Constants.multiResultsActiveContextKey,
            shouldBeActive,
        );

        if (shouldBeActive) {
            const layout = new MultiResultsLayout();
            for (const uri of this._queryResultStateMap.keys()) {
                if (!this.hasPanel(uri)) {
                    layout.add(uri);
                }
            }
            const shownUri =
                this.state?.uri ?? getUriKey(vscode.window.activeTextEditor?.document?.uri);
            if (shownUri) {
                layout.focus(shownUri);
            }
            this._multiResultsLayout = layout;
            this.updateMultiResultsView();
            return;
        }

        this._multiResultsLayout = undefined;
        this._multiResultsEntries.clear();
        // The single-result view drops results when their editor closes, so do that now for the
        // results the list was keeping.
        for (const uri of this._closedDocumentUris) {
            if (!this.hasPanel(uri)) {
                this.deleteQueryResultState(uri);
                store.deleteUriState(uri);
                void this._sqlOutputContentProvider.cleanupRunner(uri);
            }
        }
        this._closedDocumentUris.clear();
        this.updateResultsOnActiveEditorChange(vscode.window.activeTextEditor);
    }

    private getMultiResultsEntry(uri: string): mr.MultiResultsEntry {
        const state = this._queryResultStateMap.get(uri);
        return {
            uri,
            title: state?.title ?? uri,
            resultSetCount: countResultSets(state?.resultSetSummaries ?? {}),
            isExecuting: state?.isExecuting ?? false,
            hasError:
                !!state?.initializationError ||
                (state?.messages?.some((message) => message.isError) ?? false),
            isDocumentClosed: this._closedDocumentUris.has(uri),
        };
    }

    /**
     * Sends the multi-results layout to the view, along with the state of any result that has
     * just become visible.
     */
    private updateMultiResultsView(): void {
        const layout = this._multiResultsLayout;
        if (!layout) {
            return;
        }

        const shownUris = new Set(this.state?.multiResults ? this.getVisibleMultiResults() : []);
        const entries: Record<string, mr.MultiResultsEntry> = {};
        this._multiResultsEntries.clear();
        for (const uri of layout.uris) {
            const entry = this.getMultiResultsEntry(uri);
            entries[uri] = entry;
            this._multiResultsEntries.set(uri, entry);
        }

        // Send newly visible results first so their panes have state to show when they mount.
        for (const uri of layout.activeGroup?.uris ?? []) {
            if (!shownUris.has(uri)) {
                this.sendMultiResultsFileState(uri);
            }
        }

        this.state = {
            ...this.createEmptyViewState(),
            multiResults: {
                entries,
                groups: layout.groups.map((group) => ({
                    ...group,
                    uris: [...group.uris],
                    sizes: group.sizes ? [...group.sizes] : undefined,
                })),
                activeGroupId: layout.activeGroupId,
                followActiveEditor: this.followActiveEditor,
            },
        };
    }

    /** Results the view currently shows, according to the layout it was last sent. */
    private getVisibleMultiResults(): string[] {
        const multiResults = this.state?.multiResults;
        return (
            multiResults?.groups.find((group) => group.id === multiResults.activeGroupId)?.uris ??
            []
        );
    }

    /**
     * Sends the view the latest state of a result it shows. Results that are listed but not
     * shown are sent when their group is shown.
     */
    private sendMultiResultsFileState(uri: string): void {
        const state = this._queryResultStateMap.get(uri);
        if (!state || !this._multiResultsLayout?.activeGroup?.uris.includes(uri)) {
            return;
        }
        void this.sendNotification(mr.MultiResultsFileStateNotification.type, { uri, state });
    }

    private sendMultiResultsActiveGroupStates(): void {
        for (const uri of this._multiResultsLayout?.activeGroup?.uris ?? []) {
            this.sendMultiResultsFileState(uri);
        }
    }

    /**
     * Updates a result's list entry, sending the layout only when the entry changed.
     */
    private refreshMultiResultsEntry(uri: string): void {
        if (!this._multiResultsLayout?.has(uri)) {
            return;
        }
        const previous = this._multiResultsEntries.get(uri);
        const next = this.getMultiResultsEntry(uri);
        if (
            !previous ||
            previous.title !== next.title ||
            previous.resultSetCount !== next.resultSetCount ||
            previous.isExecuting !== next.isExecuting ||
            previous.hasError !== next.hasError ||
            previous.isDocumentClosed !== next.isDocumentClosed
        ) {
            this.updateMultiResultsView();
        }
    }

    /**
     * Shows a result's latest state in the multi-results view.
     */
    public updateMultiResult(uri: string): void {
        this.sendMultiResultsFileState(uri);
        this.refreshMultiResultsEntry(uri);
    }

    /**
     * Shows the group holding the result, with the result focused within it.
     */
    public focusMultiResult(uri: string): void {
        if (this._multiResultsLayout?.focus(uri)) {
            this.updateMultiResultsView();
        }
    }

    /**
     * The state of the focused result in the multi-results view, if that view is shown.
     */
    public getFocusedMultiResultState(): qr.QueryResultWebviewState | undefined {
        const uri = this._multiResultsLayout?.activeGroup?.focusedUri;
        return uri ? this._queryResultStateMap.get(uri) : undefined;
    }

    private removeFromMultiResults(uri: string): void {
        this._multiResultsLayout?.remove(uri);
        this._closedDocumentUris.delete(uri);
        this.updateMultiResultsView();
    }

    /**
     * Discards a result from the multi-results view, cancelling its query if it is running.
     */
    public async closeMultiResult(uri: string): Promise<void> {
        if (!this._multiResultsLayout?.has(uri)) {
            return;
        }
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CloseMultiResult, {
            additionalProps: {
                isExecuting: String(this._queryResultStateMap.get(uri)?.isExecuting ?? false),
            },
        });
        this.removeFromMultiResults(uri);
        store.deleteUriState(uri);

        const runner = this._sqlOutputContentProvider.getQueryRunner(uri);
        if (runner?.isExecutingQuery) {
            // A cancelled query still reports its messages and completion, which update its
            // state, so keep the state until then. A new run of the editor replaces the state,
            // which is then left alone.
            const state = this._queryResultStateMap.get(uri);
            const listener = runner.onComplete(() => {
                listener.dispose();
                if (this._queryResultStateMap.get(uri) === state) {
                    this.deleteQueryResultState(uri);
                }
            });
        } else {
            this.deleteQueryResultState(uri);
        }
        await this._sqlOutputContentProvider.cleanupRunner(uri);
    }

    private getCurrentPanelResultUri(): string | undefined {
        if (this._multiResultsLayout) {
            return this._multiResultsLayout.activeGroup?.focusedUri;
        }

        const stateUri = this.state?.uri;
        if (stateUri && this._queryResultStateMap.has(stateUri) && !this.hasPanel(stateUri)) {
            return stateUri;
        }

        const activeEditorUri = getUriKey(vscode.window.activeTextEditor?.document?.uri);
        if (
            activeEditorUri &&
            this._queryResultStateMap.has(activeEditorUri) &&
            !this.hasPanel(activeEditorUri)
        ) {
            return activeEditorUri;
        }

        return undefined;
    }

    private async moveCurrentPanelResultToDocumentTab(): Promise<void> {
        const uriToMove = this.getCurrentPanelResultUri();
        if (!uriToMove) {
            return;
        }

        await this.createPanelController(uriToMove);
    }

    public async createPanelController(uri: string) {
        const viewColumn = getNewResultPaneViewColumn(uri);
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.get(uri).revealToForeground();
            return;
        }

        const controller = new QueryResultWebviewPanelController(
            this._context,
            viewColumn,
            uri,
            this._queryResultStateMap.get(uri).title,
            this,
        );
        controller.state = this.getQueryResultState(uri);
        controller.revealToForeground();
        this._queryResultWebviewPanelControllerMap.set(uri, controller);
        if (this._multiResultsLayout) {
            this.removeFromMultiResults(uri);
        } else {
            this.showSplashScreen();
        }
        // Do not block query execution on webview bootstrap, and do not dispose
        // the panel if ready is delayed or never arrives.
        void controller.whenWebviewReady().catch((e) => {
            sendErrorEvent(TelemetryViews.QueryResult, TelemetryActions.CreatePanelController, {
                error: e instanceof Error ? e : new Error(String(e)),
                includeErrorMessage: true,
            });
            if (controller.isDisposed) {
                this._queryResultWebviewPanelControllerMap.delete(uri);
            }
        });
    }

    public addQueryResultState(uri: string, title: string, isExecutionPlan?: boolean): void {
        let currentState = {
            resultSetSummaries: {},
            messages: [],
            tabStates: {
                resultPaneTab: qr.QueryResultPaneTabs.Messages,
                resultViewMode: this.getDefaultViewModeConfig(),
            },
            uri: uri,
            title: title,
            isExecutionPlan: isExecutionPlan,
            ...(isExecutionPlan && {
                executionPlanState: {
                    loadState: ApiStatus.Loading,
                    executionPlanGraphs: [],
                    totalCost: 0,
                    xmlPlans: {},
                },
            }),
            fontSettings: {
                fontSize: this.getFontSizeConfig(),
                fontFamily: this.getFontFamilyConfig(),
            },
            gridSettings: this.getGridSettingsConfig(),
            autoSizeColumnsMode: this.getAutoSizeColumnsConfig(),
            inMemoryDataProcessingThreshold: getInMemoryGridDataProcessingThreshold(),
            isExecuting: false,
            executionElapsedMilliseconds: undefined,
            rowsAffected: undefined,
            isBetaResultsGridEnabled: this.isBetaResultsGridEnabled,
        } as qr.QueryResultWebviewState;
        this._queryResultStateMap.set(uri, currentState);

        // Results open in a tab stay there when their query runs again.
        if (this._multiResultsLayout && !this.hasPanel(uri)) {
            // Running a query shows its results even when not following the active editor.
            this._closedDocumentUris.delete(uri);
            this._multiResultsLayout.add(uri);
            this._multiResultsLayout.focus(uri);
            this.updateMultiResultsView();
            this.sendMultiResultsFileState(uri);
        }
    }

    public getAutoSizeColumnsConfig(): qr.ResultsGridAutoSizeStyle {
        const configValue = vscode.workspace
            .getConfiguration(Constants.extensionName)
            .get(Constants.configAutoColumnSizingMode) as
            | qr.ResultsGridAutoSizeStyle
            | boolean
            | undefined;

        if (typeof configValue === "string") {
            const validModes = Object.values(qr.ResultsGridAutoSizeStyle);
            if (validModes.includes(configValue as qr.ResultsGridAutoSizeStyle)) {
                return configValue as qr.ResultsGridAutoSizeStyle;
            }
        }

        if (configValue === false) {
            return qr.ResultsGridAutoSizeStyle.Off;
        }

        return qr.ResultsGridAutoSizeStyle.HeadersAndData;
    }

    public getFontSizeConfig(): number {
        return (
            (vscode.workspace
                .getConfiguration(Constants.extensionName)
                .get(Constants.extConfigResultKeys.ResultsFontSize) as number) ??
            (vscode.workspace.getConfiguration("editor").get("fontSize") as number)
        );
    }

    public getFontFamilyConfig(): string {
        return vscode.workspace
            .getConfiguration(Constants.extensionName)
            .get(Constants.extConfigResultKeys.ResultsFontFamily) as string;
    }

    public getGridSettingsConfig(): qr.GridSettings {
        const config = vscode.workspace.getConfiguration(Constants.extensionName);
        const validGridLineModes: qr.GridLinesMode[] = ["both", "horizontal", "vertical", "none"];
        const gridLinesValue = config.get(Constants.configResultsGridShowGridLines) as string;
        const showGridLines: qr.GridLinesMode = validGridLineModes.includes(
            gridLinesValue as qr.GridLinesMode,
        )
            ? (gridLinesValue as qr.GridLinesMode)
            : "both";
        return {
            alternatingRowColors:
                (config.get(Constants.configResultsGridAlternatingRowColors) as boolean) ?? false,
            freezeFirstColumnByDefault:
                (config.get(Constants.configResultsGridFreezeFirstColumnByDefault) as boolean) ??
                false,
            showGridLines,
            rowPadding: config.get(Constants.configResultsGridRowPadding) as number | undefined,
            rightAlignNumbers:
                (config.get(Constants.configResultsGridRightAlignNumbers) as boolean) ?? false,
        };
    }

    public getDefaultViewModeConfig(): qr.QueryResultViewMode {
        const configValue = vscode.workspace
            .getConfiguration(Constants.extensionName)
            .get("defaultQueryResultsViewMode") as string;

        return qr.QueryResultViewMode[configValue] ?? qr.QueryResultViewMode.Grid;
    }

    public setQueryResultState(uri: string, state: qr.QueryResultWebviewState) {
        this._queryResultStateMap.set(uri, state);
    }

    public setSelectionSummaryContinuation(uri: string, continuation?: Deferred<void>): void {
        if (continuation) {
            this._selectionSummaryContinuations.set(uri, continuation);
        } else {
            this._selectionSummaryContinuations.delete(uri);
        }
    }

    public updateSelectionState(
        uri: string,
        gridId: string,
        selection: qr.ISlickRange[],
        displaySelection: qr.ISlickRange[],
    ): void {
        const state = this._queryResultStateMap.get(uri);
        if (!state) {
            return;
        }

        state.selection = selection;
        state.gridSelections = {
            ...(state.gridSelections ?? {}),
            [gridId]: displaySelection,
        };
        this._queryResultStateMap.set(uri, state);

        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this.updatePanelState(uri);
        } else if (this._multiResultsLayout) {
            this.sendMultiResultsFileState(uri);
        } else if (this.state?.uri === uri) {
            this.state = state;
        }
    }

    public hasQueryResultState(uri: string): boolean {
        return this._queryResultStateMap.has(uri);
    }

    public deleteQueryResultState(uri: string): void {
        this._queryResultStateMap.delete(uri);
        this._selectionSummaryContinuations.delete(uri);
        this._multiResultsEntries.delete(uri);
    }

    public updatePanelState(uri: string): void {
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap
                .get(uri)
                .updateState(this.getQueryResultState(uri));
        }
    }

    private updatePanelUri(oldUri: string, newUri: string): void {
        const controller = this._queryResultWebviewPanelControllerMap.get(oldUri);
        if (!controller || oldUri === newUri) {
            return;
        }

        this._queryResultWebviewPanelControllerMap.delete(oldUri);
        this._queryResultWebviewPanelControllerMap.set(newUri, controller);
        controller.updateUri(newUri);
    }

    public updateUri(oldUri: string, newUri: string): void {
        if (oldUri === newUri) {
            return;
        }

        this.updatePanelUri(oldUri, newUri);

        if (!this._queryResultStateMap.has(oldUri)) {
            return;
        }

        const state = this.getQueryResultState(oldUri);
        state.uri = newUri;
        this._queryResultStateMap.set(newUri, state);
        this._queryResultStateMap.delete(oldUri);

        if (this._multiResultsLayout?.has(oldUri)) {
            // Replaces any result already listed under the new URI.
            this._multiResultsLayout.rename(oldUri, newUri);
            const wasClosed = this._closedDocumentUris.delete(oldUri);
            this._closedDocumentUris.delete(newUri);
            if (wasClosed) {
                this._closedDocumentUris.add(newUri);
            }
        }

        // Update state in panel or webview view depending on where it is currently shown
        if (this._queryResultWebviewPanelControllerMap.has(newUri)) {
            this._queryResultWebviewPanelControllerMap.get(newUri).updateState(state);
        } else if (this._multiResultsLayout) {
            this.updateMultiResultsView();
        } else if (this.isVisible()) {
            this.state = state;
        }
    }

    public async removePanel(uri: string): Promise<void> {
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.delete(uri);

            // Check if we should keep the state instead of cleaning up
            const documentStillOpen = vscode.workspace.textDocuments.some(
                (doc) => getUriKey(doc.uri) === uri,
            );
            const shouldKeepState =
                documentStillOpen && !this.isOpenQueryResultsInTabByDefaultEnabled;

            if (shouldKeepState) {
                // Keep the state - only show in webview view if the document is active
                const activeDocumentUri = getUriKey(vscode.window.activeTextEditor?.document?.uri);
                if (this._multiResultsLayout) {
                    // The results go back to the list of results in the view.
                    this._multiResultsLayout.add(uri);
                    if (activeDocumentUri === uri && this.followActiveEditor) {
                        this._multiResultsLayout.focus(uri);
                    }
                    this.updateMultiResultsView();
                } else if (activeDocumentUri === uri && this.isVisible()) {
                    this.state = this.getQueryResultState(uri);
                }
                // Otherwise just keep the state in the map for when the user switches back
            } else {
                // Clean up the state and query runner
                this._queryResultStateMap.delete(uri);
                await this._sqlOutputContentProvider.cleanupRunner(uri);
            }

            this.updateSelectionSummary();
        }
    }

    /**
     * Updates the editor status bar item that shows the grid selection summary.
     *
     * When the query results footer preview is enabled the selection summary is rendered inside
     * the results view footer, so the status bar item is hidden. Otherwise it reflects the
     * selection summary of the active query result.
     */
    public updateSelectionSummary(): void {
        if (this.isBetaResultsGridEnabled) {
            this._selectionSummaryStatusBarItem.hide();
            return;
        }

        let activeUri = Array.from(this._queryResultWebviewPanelControllerMap.keys()).find(
            (uri) => this._queryResultWebviewPanelControllerMap.get(uri).panel.active,
        );

        if (!activeUri) {
            activeUri = getUriKey(vscode.window.activeTextEditor?.document.uri);
        }

        const summary = activeUri
            ? this._queryResultStateMap.get(activeUri)?.selectionSummary
            : undefined;

        if (summary?.text) {
            this._selectionSummaryStatusBarItem.text = summary.text;
            this._selectionSummaryStatusBarItem.tooltip = summary.tooltip;
            this._selectionSummaryStatusBarItem.command = summary.command;
            this._selectionSummaryStatusBarItem.show();
        } else {
            this._selectionSummaryStatusBarItem.hide();
        }
    }

    public hasPanel(uri: string): boolean {
        return this._queryResultWebviewPanelControllerMap.has(uri);
    }

    public revealPanel(uri: string): void {
        if (this.hasPanel(uri)) {
            this._queryResultWebviewPanelControllerMap.get(uri).revealToForeground();
        }
    }

    public getQueryResultState(uri: string): qr.QueryResultWebviewState {
        var res = this._queryResultStateMap.get(uri);
        if (!res) {
            // This should never happen

            const error = new Error(`No query result state found for uri ${uri}`);
            sendErrorEvent(TelemetryViews.QueryResult, TelemetryActions.GetQueryResultState, {
                error: new Error(`No query result state found for uri`),
                includeErrorMessage: false,
            });

            throw error;
        }
        return res;
    }

    public getSqlOutputContentProvider(): SqlOutputContentProvider {
        return this._sqlOutputContentProvider;
    }

    public getContext(): vscode.ExtensionContext {
        return this._context;
    }

    public get executionPlanService(): ExecutionPlanService {
        return this._executionPlanService;
    }

    public set sqlDocumentService(service: SqlDocumentService) {
        this._sqlDocumentService = service;
    }

    public get sqlDocumentService(): SqlDocumentService {
        return this._sqlDocumentService;
    }

    private shouldCopyMessageTimestamps(uri?: string): boolean {
        return vscode.workspace
            .getConfiguration(
                Constants.extensionConfigSectionName,
                uri ? vscode.Uri.parse(uri) : undefined,
            )
            .get<boolean>(Constants.configMessagesCopyIncludeTimestamps, false);
    }

    public async copyAllMessagesToClipboard(uri: string): Promise<void> {
        const includeTimestamps = this.shouldCopyMessageTimestamps(uri ?? this.state?.uri);
        const messages = uri
            ? this.getQueryResultState(uri)?.messages?.map((message) =>
                  messageToString(message, includeTimestamps),
              )
            : this.state?.messages?.map((message) => messageToString(message, includeTimestamps));

        if (!messages) {
            return;
        }

        const messageText = messages.join("\n");
        await vscode.env.clipboard.writeText(messageText);
    }

    public getNumExecutionPlanResultSets(
        resultSetSummaries: qr.QueryResultWebviewState["resultSetSummaries"],
        actualPlanEnabled: boolean,
    ): number {
        const summariesLength = recordLength(resultSetSummaries);
        if (!actualPlanEnabled) {
            return summariesLength;
        }
        // count the amount of xml showplans in the result summaries
        let total = 0;
        Object.values(resultSetSummaries).forEach((batch) => {
            Object.values(batch).forEach((result) => {
                // Check if any column in columnInfo has the specific column name
                if (result.columnInfo[0].columnName === Constants.showPlanXmlColumnName) {
                    total++;
                }
            });
        });
        return total;
    }
}
