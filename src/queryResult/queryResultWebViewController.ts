/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { ReactWebviewViewController } from "../controllers/reactWebviewViewController";
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
    messageToString,
    recordLength,
    registerCommonRequestHandlers,
} from "./utils";
import { QueryResult } from "../constants/locConstants";

export class QueryResultWebviewController extends ReactWebviewViewController<
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
    private _selectionSummaryStatusBarItem: vscode.StatusBarItem =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
    public actualPlanStatuses: string[] = [];
    private _sqlDocumentService: SqlDocumentService;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private executionPlanService: ExecutionPlanService,
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
        });

        void this.initialize();

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                const uri = editor?.document?.uri?.toString(true);
                const hasPanel = uri && this.hasPanel(uri);
                const hasWebviewViewState = uri && this._queryResultStateMap.has(uri);

                if (hasWebviewViewState && !hasPanel) {
                    this.state = this.getQueryResultState(uri);
                } else if (hasPanel) {
                    const editorViewColumn = editor?.viewColumn;
                    const panelViewColumn =
                        this._queryResultWebviewPanelControllerMap.get(uri).viewColumn;

                    /**
                     * If the results are shown in webview panel, and the active editor is not in the same
                     * view column as the results, then reveal the panel to the foreground
                     */
                    if (this.shouldAutoRevealResultsPanel && editorViewColumn !== panelViewColumn) {
                        this.revealPanel(uri);
                    }
                } else {
                    this.showSplashScreen();
                }
            }),
        );

        // not the best api but it's the best we can do in VSCode
        context.subscriptions.push(
            this.vscodeWrapper.onDidOpenTextDocument((document) => {
                const uri = document.uri.toString(true);
                if (this._queryResultStateMap.has(uri)) {
                    this._queryResultStateMap.delete(uri);
                }
            }),
        );

        context.subscriptions.push(
            this.vscodeWrapper.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration("mssql.resultsFontFamily")) {
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.fontSettings.fontFamily = this.vscodeWrapper
                            .getConfiguration(Constants.extensionName)
                            .get(Constants.extConfigResultKeys.ResultsFontFamily);
                        this._queryResultStateMap.set(uri, state);
                    }
                }
                if (e.affectsConfiguration("mssql.resultsFontSize")) {
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.fontSettings.fontSize =
                            (this.vscodeWrapper
                                .getConfiguration(Constants.extensionName)
                                .get(Constants.extConfigResultKeys.ResultsFontSize) as number) ??
                            (this.vscodeWrapper
                                .getConfiguration("editor")
                                .get("fontSize") as number);
                        this._queryResultStateMap.set(uri, state);
                    }
                }
                if (e.affectsConfiguration("mssql.resultsGrid.autoSizeColumns")) {
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.autoSizeColumns = this.getAutoSizeColumnsConfig();
                        this._queryResultStateMap.set(uri, state);
                    }
                }
                if (e.affectsConfiguration("mssql.resultsGrid.inMemoryDataProcessingThreshold")) {
                    for (const [uri, state] of this._queryResultStateMap) {
                        state.inMemoryDataProcessingThreshold = this.vscodeWrapper
                            .getConfiguration(Constants.extensionName)
                            .get(Constants.configInMemoryDataProcessingThreshold);
                        this._queryResultStateMap.set(uri, state);
                    }
                }
            }),
        );
    }

    private get shouldAutoRevealResultsPanel(): boolean {
        return this.vscodeWrapper.getConfiguration().get(Constants.configAutoRevealResultsPanel);
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
            fontSettings: {
                fontSize: this.getFontSizeConfig(),

                fontFamily: this.getFontFamilyConfig(),
            },
            autoSizeColumns: this.getAutoSizeColumnsConfig(),
            inMemoryDataProcessingThreshold: this.getInMemoryDataProcessingThresholdConfig(),
            initializationError: undefined,
        };
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
        await controller.whenWebviewReady();
    }

    public addQueryResultState(
        uri: string,
        title: string,
        isExecutionPlan?: boolean,
        actualPlanEnabled?: boolean,
    ): void {
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
            actualPlanEnabled: actualPlanEnabled,
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
            autoSizeColumns: this.getAutoSizeColumnsConfig(),
            inMemoryDataProcessingThreshold: this.getInMemoryDataProcessingThresholdConfig(),
        };
        this._queryResultStateMap.set(uri, currentState);
    }

    public getAutoSizeColumnsConfig(): boolean {
        return this.vscodeWrapper
            .getConfiguration(Constants.extensionName)
            .get(Constants.configAutoColumnSizing);
    }

    public getInMemoryDataProcessingThresholdConfig(): number {
        return this.vscodeWrapper
            .getConfiguration(Constants.extensionName)
            .get(Constants.configInMemoryDataProcessingThreshold);
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

    public getDefaultViewModeConfig(): qr.QueryResultViewMode {
        const configValue = this.vscodeWrapper
            .getConfiguration(Constants.extensionName)
            .get("defaultQueryResultsViewMode") as string;

        return qr.QueryResultViewMode[configValue] ?? qr.QueryResultViewMode.Grid;
    }

    public setQueryResultState(uri: string, state: qr.QueryResultWebviewState) {
        this._queryResultStateMap.set(uri, state);
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

    public async removePanel(uri: string): Promise<void> {
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.delete(uri);
            /**
             * Remove the corresponding query runner on panel closed
             */
            await this._sqlOutputContentProvider.cleanupRunner(uri);
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
                error,
                false, // includeErrorMessage
            );

            throw error;
        }
        return res;
    }

    public getSqlOutputContentProvider(): SqlOutputContentProvider {
        return this._sqlOutputContentProvider;
    }

    public getExecutionPlanService(): ExecutionPlanService {
        return this.executionPlanService;
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

    public updateSelectionSummaryStatusItem(selectionSummary: qr.SelectionSummaryStats) {
        if (selectionSummary.removeSelectionStats) {
            this._selectionSummaryStatusBarItem.text = "";
            this._selectionSummaryStatusBarItem.hide();
        } else {
            // the selection is numeric
            if (selectionSummary.average) {
                this._selectionSummaryStatusBarItem.text = QueryResult.numericSelectionSummary(
                    selectionSummary.average,
                    selectionSummary.count,
                    selectionSummary.sum,
                );
                this._selectionSummaryStatusBarItem.tooltip =
                    QueryResult.numericSelectionSummaryTooltip(
                        selectionSummary.average,
                        selectionSummary.count,
                        selectionSummary.distinctCount,
                        selectionSummary.max,
                        selectionSummary.min,
                        selectionSummary.nullCount,
                        selectionSummary.sum,
                    );
            } else {
                this._selectionSummaryStatusBarItem.text = QueryResult.nonNumericSelectionSummary(
                    selectionSummary.count,
                    selectionSummary.distinctCount,
                    selectionSummary.nullCount,
                );
                this._selectionSummaryStatusBarItem.tooltip =
                    this._selectionSummaryStatusBarItem.text;
            }
            this._selectionSummaryStatusBarItem.show();
        }
    }
}
