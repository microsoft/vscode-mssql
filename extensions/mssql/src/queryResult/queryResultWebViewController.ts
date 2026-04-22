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
    private _correlationId: string = randomUUID();
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
        });

        void this.initialize();

        // not the best api but it's the best we can do in VSCode
        context.subscriptions.push(
            this.vscodeWrapper.onDidCloseTextDocument((document) => {
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
                (state.selectionSummary?.continue as Deferred<void> | undefined)?.resolve();
            }),
        );
    }

    private get shouldAutoRevealResultsPanel(): boolean {
        return this.vscodeWrapper.getConfiguration().get(Constants.configAutoRevealResultsPanel);
    }

    public updateResultsOnActiveEditorChange(editor: vscode.TextEditor | undefined): void {
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
            .get(Constants.configOpenQueryResultsInTabByDefault);
    }

    private get isDefaultQueryResultToDocumentDoNotShowPromptEnabled(): boolean {
        return this.vscodeWrapper
            .getConfiguration()
            .get(Constants.configOpenQueryResultsInTabByDefaultDoNotShowPrompt);
    }

    private get shouldShowDefaultQueryResultToDocumentPrompt(): boolean {
        return (
            !this.isOpenQueryResultsInTabByDefaultEnabled &&
            !this.isDefaultQueryResultToDocumentDoNotShowPromptEnabled
        );
    }

    private registerRpcHandlers() {
        this.onRequest(qr.OpenInNewTabRequest.type, async (message) => {
            void this.createPanelController(message.uri);

            if (this.shouldShowDefaultQueryResultToDocumentPrompt) {
                const response = await this.vscodeWrapper.showInformationMessage(
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
            fontSettings: {
                fontSize: this.getFontSizeConfig(),
                fontFamily: this.getFontFamilyConfig(),
            },
            gridSettings: this.getGridSettingsConfig(),
            autoSizeColumnsMode: this.getAutoSizeColumnsConfig(),
            inMemoryDataProcessingThreshold: getInMemoryGridDataProcessingThreshold(),
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
            void this.vscodeWrapper.showErrorMessage(
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

    public hasQueryResultState(uri: string): boolean {
        return this._queryResultStateMap.has(uri);
    }

    public deleteQueryResultState(uri: string): void {
        this._queryResultStateMap.delete(uri);
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

    public async copyAllMessagesToClipboard(uri: string): Promise<void> {
        const messages = uri
            ? this.getQueryResultState(uri)?.messages?.map((message) => messageToString(message))
            : this.state?.messages?.map((message) => messageToString(message));

        if (!messages) {
            return;
        }

        const messageText = messages.join("\n");
        await this.vscodeWrapper.clipboardWriteText(messageText);
        void this.notifyCopySuccess(uri);
    }

    public async notifyCopySuccess(uri: string): Promise<void> {
        if (!uri || !this._queryResultStateMap.has(uri)) {
            return;
        }

        if (this.hasPanel(uri)) {
            const panelController = this._queryResultWebviewPanelControllerMap.get(uri);
            if (panelController) {
                await panelController.sendNotification(
                    qr.ShowCopySuccessNotification.type,
                    undefined,
                );
            }
            return;
        }

        if (this.state?.uri === uri) {
            await this.sendNotification(qr.ShowCopySuccessNotification.type, undefined);
        }
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

    public getOpenQueryResultsInTabByDefaultRequestHandler(): boolean {
        return this.vscodeWrapper
            .getConfiguration()
            .get<boolean>(Constants.configOpenQueryResultsInTabByDefault, false);
    }

    public async setOpenQueryResultsInTabByDefaultRequestHandler(enabled: boolean): Promise<void> {
        const configuration = this.vscodeWrapper.getConfiguration();
        const previousValue = configuration.get<boolean>(
            Constants.configOpenQueryResultsInTabByDefault,
            false,
        );

        await configuration.update(
            Constants.configOpenQueryResultsInTabByDefault,
            enabled,
            vscode.ConfigurationTarget.Global,
        );

        // Skip the one-time prompt after users explicitly choose their preferred result location.
        await configuration.update(
            Constants.configOpenQueryResultsInTabByDefaultDoNotShowPrompt,
            true,
            vscode.ConfigurationTarget.Global,
        );

        if (enabled) {
            await this.moveCurrentPanelResultToDocumentTab();
        }

        sendActionEvent(
            TelemetryViews.QueryResult,
            TelemetryActions.QueryResultsTabDefaultSettingToggled,
            {
                enabled: enabled.toString(),
                previousValue: previousValue.toString(),
            },
        );
    }
}
