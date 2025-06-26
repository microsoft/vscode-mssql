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
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
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
    private _sqlOutputContentProvider: SqlOutputContentProvider;
    private _correlationId: string = randomUUID();
    private _selectionSummaryStatusBarItem: vscode.StatusBarItem =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
    public actualPlanStatuses: string[] = [];

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private executionPlanService: ExecutionPlanService,
        private untitledSqlDocumentService: UntitledSqlDocumentService,
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

        if (
            !this.vscodeWrapper
                .getConfiguration()
                .get(Constants.configUseLegacyQueryResultExperience)
        ) {
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                const uri = editor?.document?.uri?.toString(true);
                if (uri && this._queryResultStateMap.has(uri)) {
                    this.state = this.getQueryResultState(uri);
                } else {
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
                        inMemoryDataProcessingThreshold:
                            this.getInMemoryDataProcessingThresholdConfig(),
                    };
                }
            });

            // not the best api but it's the best we can do in VSCode
            this.vscodeWrapper.onDidOpenTextDocument((document) => {
                const uri = document.uri.toString(true);
                if (this._queryResultStateMap.has(uri)) {
                    this._queryResultStateMap.delete(uri);
                }
            });
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
            });
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
        this.onRequest(qr.ShowFilterDisabledMessageRequest.type, async () => {
            this.vscodeWrapper.showInformationMessage(
                LocalizedConstants.inMemoryDataProcessingThresholdExceeded,
            );
        });
        registerCommonRequestHandlers(this, this._correlationId);
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
        if (this.isVisible()) {
            await vscode.commands.executeCommand("workbench.action.togglePanel");
        }
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
            this._queryResultWebviewPanelControllerMap.get(uri).revealToForeground();
        }
    }

    public removePanel(uri: string): void {
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.delete(uri);
        }
    }

    public hasPanel(uri: string): boolean {
        return this._queryResultWebviewPanelControllerMap.has(uri);
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

    public addResultSetSummary(uri: string, resultSetSummary: qr.ResultSetSummary) {
        let state = this.getQueryResultState(uri);
        const batchId = resultSetSummary.batchId;
        const resultId = resultSetSummary.id;
        if (!state.resultSetSummaries[batchId]) {
            state.resultSetSummaries[batchId] = {};
        }
        state.resultSetSummaries[batchId][resultId] = resultSetSummary;
    }

    public setSqlOutputContentProvider(provider: SqlOutputContentProvider): void {
        this._sqlOutputContentProvider = provider;
    }

    public getSqlOutputContentProvider(): SqlOutputContentProvider {
        return this._sqlOutputContentProvider;
    }

    public setExecutionPlanService(service: ExecutionPlanService): void {
        this.executionPlanService = service;
    }

    public getExecutionPlanService(): ExecutionPlanService {
        return this.executionPlanService;
    }

    public setUntitledDocumentService(service: UntitledSqlDocumentService): void {
        this.untitledSqlDocumentService = service;
    }

    public getUntitledDocumentService(): UntitledSqlDocumentService {
        return this.untitledSqlDocumentService;
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
