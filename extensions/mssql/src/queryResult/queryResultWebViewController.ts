/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { WebviewViewController } from "../controllers/webviewViewController";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { randomUUID } from "crypto";
import { ApiStatus } from "../sharedInterfaces/webview";
import SqlDocumentService from "../controllers/sqlDocumentService";
import { ExecutionPlanService } from "../services/executionPlanService";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { QueryResultWebviewPanelController } from "./queryResultWebviewPanelController";
import {
    getNewResultPaneViewColumn,
    getInMemoryGridDataProcessingThreshold,
    messageToString,
    recordLength,
    registerCommonRequestHandlers,
} from "./utils";
import { Deferred } from "../protocol";
import { getUriKey } from "../utils/utils";
import { getPreviewConfigKey, PreviewFeature, previewService } from "../previews/previewService";

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
     * Editor status bar item used to show the grid selection summary when the query results
     * footer preview is disabled. When the footer preview is enabled, the selection summary is
     * shown inside the results view footer instead and this item stays hidden.
     */
    private _selectionSummaryStatusBarItem: vscode.StatusBarItem =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
    public actualPlanStatuses: string[] = [];
    private _sqlDocumentService: SqlDocumentService;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _executionPlanService: ExecutionPlanService,
        private _sqlOutputContentProvider: SqlOutputContentProvider,
    ) {
        super(context, vscodeWrapper, "queryResult", "queryResult", {
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
            isBetaResultsGridEnabled: previewService.isFeatureEnabled(
                PreviewFeature.BetaResultsGrid,
            ),
        });

        void this.initialize();

        context.subscriptions.push(this._selectionSummaryStatusBarItem);

        // not the best api but it's the best we can do in VSCode
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                const uri = getUriKey(document.uri);
                if (this._sqlDocumentService?.isUriBeingRenamedOrSaved(uri)) {
                    return;
                }
                if (this._queryResultStateMap.has(uri)) {
                    this._queryResultStateMap.delete(uri);
                }
            }),
        );

        context.subscriptions.push(
            this.vscodeWrapper.onDidChangeConfiguration((e) => {
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
                if (e.affectsConfiguration(getPreviewConfigKey(PreviewFeature.BetaResultsGrid))) {
                    const newValue = this.isBetaResultsGridEnabled;
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.isBetaResultsGridEnabled = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    this.updateSelectionSummary();
                    stateChanged = true;
                }
                if (
                    e.affectsConfiguration("mssql.resultsGrid.alternatingRowColors") ||
                    e.affectsConfiguration("mssql.resultsGrid.showGridLines") ||
                    e.affectsConfiguration("mssql.resultsGrid.rowPadding")
                ) {
                    const newValue = this.getGridSettingsConfig();
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.gridSettings = newValue;
                        this._queryResultStateMap.set(uri, state);
                    }
                    stateChanged = true;
                }
                if (stateChanged) {
                    // Push updates to all open panel controllers
                    for (const [uri] of this._queryResultStateMap) {
                        this.updatePanelState(uri);
                    }
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
                const state = this._queryResultStateMap.get(uri);
                if (!state) {
                    return;
                }
                this._selectionSummaryContinuations.get(uri)?.resolve();
            }),
        );
    }

    private get shouldAutoRevealResultsPanel(): boolean {
        return this.vscodeWrapper.getConfiguration().get(Constants.configAutoRevealResultsPanel);
    }

    public updateResultsOnActiveEditorChange(editor: vscode.TextEditor | undefined): void {
        this.updateSelectionSummary();

        const uri = getUriKey(editor?.document?.uri);
        const hasPanel = uri && this.hasPanel(uri);
        const hasWebviewViewState = uri && this._queryResultStateMap.has(uri);

        if (hasWebviewViewState) {
            if (hasPanel) {
                const editorViewColumn = editor?.viewColumn;
                const panelViewColumn =
                    this._queryResultWebviewPanelControllerMap.get(uri).viewColumn;
                /**
                 * If the results are shown in a webview panel and the active editor is not in the same
                 * view column as the results, then reveal the panel to the foreground. We explicitly
                 * check that the editor and results are in different columns before revealing so that
                 * we do not cover the query editor when the results share the same column.
                 */
                if (this.shouldAutoRevealResultsPanel && editorViewColumn !== panelViewColumn) {
                    this.revealPanel(uri);
                }
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

    private async initialize() {
        this.registerRpcHandlers();
    }

    private get isOpenQueryResultsInTabByDefaultEnabled(): boolean {
        return this.vscodeWrapper
            .getConfiguration()
            .get<boolean>(Constants.configOpenQueryResultsInTabByDefault, false);
    }

    private get isDefaultQueryResultToDocumentDoNotShowPromptEnabled(): boolean {
        return this.vscodeWrapper
            .getConfiguration()
            .get<boolean>(Constants.configOpenQueryResultsInTabByDefaultDoNotShowPrompt, false);
    }

    private get shouldShowDefaultQueryResultToDocumentPrompt(): boolean {
        return (
            !this.isOpenQueryResultsInTabByDefaultEnabled &&
            !this.isDefaultQueryResultToDocumentDoNotShowPromptEnabled
        );
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
                        response: telemResponse,
                    },
                );

                if (response === LocalizedConstants.alwaysShowInNewTab) {
                    await this.vscodeWrapper
                        .getConfiguration()
                        .update(
                            Constants.configOpenQueryResultsInTabByDefault,
                            true,
                            vscode.ConfigurationTarget.Global,
                        );
                }
                // show the prompt only once
                await this.vscodeWrapper
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
    }

    private showSplashScreen() {
        this.state = {
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

    private getCurrentPanelResultUri(): string | undefined {
        const stateUri = this.state?.uri;
        if (stateUri && this._queryResultStateMap.has(stateUri) && !this.hasPanel(stateUri)) {
            return stateUri;
        }

        const activeEditorUri = getUriKey(this.vscodeWrapper.activeTextEditor?.document?.uri);
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
        const viewColumn = getNewResultPaneViewColumn(uri, this.vscodeWrapper);
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.get(uri).revealToForeground();
            return;
        }

        const controller = new QueryResultWebviewPanelController(
            this._context,
            this.vscodeWrapper,
            viewColumn,
            uri,
            this._queryResultStateMap.get(uri).title,
            this,
        );
        controller.state = this.getQueryResultState(uri);
        controller.revealToForeground();
        this._queryResultWebviewPanelControllerMap.set(uri, controller);
        this.showSplashScreen();
        try {
            await controller.whenWebviewReady();
        } catch (e) {
            // If the webview was disposed or timed out before it became ready, clean up the
            // panel controller entry so callers are not blocked indefinitely.
            sendErrorEvent(
                TelemetryViews.QueryResult,
                TelemetryActions.CreatePanelController,
                e instanceof Error ? e : new Error(String(e)),
                true, // includeErrorMessage
            );
            this._queryResultWebviewPanelControllerMap.delete(uri);
            controller.panel.dispose();
            void vscode.window.showErrorMessage(
                LocalizedConstants.QueryResult.queryResultPanelFailedToLoad,
            );
            throw e;
        }
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
    }

    public getAutoSizeColumnsConfig(): qr.ResultsGridAutoSizeStyle {
        const configValue = this.vscodeWrapper
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
            (this.vscodeWrapper
                .getConfiguration(Constants.extensionName)
                .get(Constants.extConfigResultKeys.ResultsFontSize) as number) ??
            (this.vscodeWrapper.getConfiguration("editor").get("fontSize") as number)
        );
    }

    public getFontFamilyConfig(): string {
        return this.vscodeWrapper
            .getConfiguration(Constants.extensionName)
            .get(Constants.extConfigResultKeys.ResultsFontFamily) as string;
    }

    public getGridSettingsConfig(): qr.GridSettings {
        const config = this.vscodeWrapper.getConfiguration(Constants.extensionName);
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
            showGridLines,
            rowPadding: config.get(Constants.configResultsGridRowPadding) as number | undefined,
        };
    }

    public getDefaultViewModeConfig(): qr.QueryResultViewMode {
        const configValue = this.vscodeWrapper
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

        // Update state in panel or webview view depending on where it is currently shown
        if (this._queryResultWebviewPanelControllerMap.has(newUri)) {
            this._queryResultWebviewPanelControllerMap.get(newUri).updateState(state);
        } else if (this.isVisible()) {
            this.state = state;
        }
    }

    public async removePanel(uri: string): Promise<void> {
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.delete(uri);

            // Check if we should keep the state instead of cleaning up
            const documentStillOpen = this.vscodeWrapper.textDocuments.some(
                (doc) => getUriKey(doc.uri) === uri,
            );
            const shouldKeepState =
                documentStillOpen && !this.isOpenQueryResultsInTabByDefaultEnabled;

            if (shouldKeepState) {
                // Keep the state - only show in webview view if the document is active
                const activeDocumentUri = getUriKey(
                    this.vscodeWrapper.activeTextEditor?.document?.uri,
                );
                if (activeDocumentUri === uri && this.isVisible()) {
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
            sendErrorEvent(
                TelemetryViews.QueryResult,
                TelemetryActions.GetQueryResultState,
                new Error(`No query result state found for uri`),
                false, // includeErrorMessage
            );

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

    public getVsCodeWrapper(): VscodeWrapper {
        return this.vscodeWrapper;
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
        return this.vscodeWrapper
            .getConfiguration(Constants.extensionConfigSectionName, uri)
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
