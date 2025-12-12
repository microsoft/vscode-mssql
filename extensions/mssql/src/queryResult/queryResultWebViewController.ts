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
import { sendActionEvent } from "../telemetry/telemetry";
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
            autoSizeColumnsMode: qr.ResultsGridAutoSizeStyle.HeadersAndData,
        });

        void this.initialize();

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                this.updateSelectionSummary();
                const uri = editor?.document?.uri?.toString(true);
                const hasPanel = uri && this.hasPanel(uri);
                const hasWebviewViewState = uri && this._queryResultStateMap.has(uri);

                if (hasWebviewViewState && !hasPanel) {
                    const state = this.getQueryResultState(uri);
                    if (state) {
                        this.state = state;
                    } else {
                        this.showSplashScreen();
                    }
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
                        state.autoSizeColumnsMode = this.getAutoSizeColumnsConfig();
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

        context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdHandleSummaryOperation, async (uri) => {
                const state = this._queryResultStateMap.get(uri);
                if (!state) {
                    return;
                }
                (state.selectionSummary.continue as Deferred<void>).resolve();
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
            autoSizeColumnsMode: this.getAutoSizeColumnsConfig(),
            inMemoryDataProcessingThreshold: getInMemoryGridDataProcessingThreshold(),
            initializationError: undefined,
        };
    }

    public async createPanelController(uri: string) {
        const viewColumn = getNewResultPaneViewColumn(uri, this.vscodeWrapper);
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.get(uri).revealToForeground();
            return;
        }

        const state = this.getQueryResultState(uri);
        if (!state) {
            // Avoid sending undefined state to a webview.
            return;
        }

        const controller = new QueryResultWebviewPanelController(
            this._context,
            this.vscodeWrapper,
            viewColumn,
            uri,
            state.title,
            this,
        );
        controller.state = state;
        controller.revealToForeground();
        this._queryResultWebviewPanelControllerMap.set(uri, controller);
        this.showSplashScreen();
        await controller.whenWebviewReady();
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
            autoSizeColumnsMode: this.getAutoSizeColumnsConfig(),
            inMemoryDataProcessingThreshold: getInMemoryGridDataProcessingThreshold(),
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
            const state = this.getQueryResultState(uri);
            if (!state) {
                return;
            }
            this._queryResultWebviewPanelControllerMap.get(uri).updateState(state);
        }
    }

    public async removePanel(uri: string): Promise<void> {
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap.delete(uri);

            // Check if we should keep the state instead of cleaning up
            const documentStillOpen = this.vscodeWrapper.textDocuments.some(
                (doc) => doc.uri.toString(true) === uri,
            );
            const shouldKeepState =
                documentStillOpen && !this.isOpenQueryResultsInTabByDefaultEnabled;

            if (shouldKeepState) {
                // Keep the state - only show in webview view if the document is active
                const activeDocumentUri =
                    this.vscodeWrapper.activeTextEditor?.document?.uri?.toString(true);
                if (activeDocumentUri === uri && this.isVisible()) {
                    const state = this.getQueryResultState(uri);
                    if (state) {
                        this.state = state;
                    } else {
                        this.showSplashScreen();
                    }
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

    public getQueryResultState(uri: string): qr.QueryResultWebviewState | undefined {
        return this._queryResultStateMap.get(uri);
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

    public override set state(state: qr.QueryResultWebviewState) {
        if (this.isOpenQueryResultsInTabByDefaultEnabled) {
            return;
        }
        super.state = state;
    }

    public updateSelectionSummary() {
        let activeUri = Array.from(this._queryResultWebviewPanelControllerMap.keys()).find(
            (uri) => this._queryResultWebviewPanelControllerMap.get(uri).panel.active,
        );

        if (!activeUri) {
            activeUri = vscode.window.activeTextEditor?.document.uri.toString(true);
        }

        if (!this._queryResultStateMap.has(activeUri)) {
            this._selectionSummaryStatusBarItem.hide();
            return;
        }

        const state = this._queryResultStateMap.get(activeUri);

        if (state?.selectionSummary) {
            this._selectionSummaryStatusBarItem.text = state.selectionSummary.text;
            this._selectionSummaryStatusBarItem.tooltip = state.selectionSummary.tooltip;
            this._selectionSummaryStatusBarItem.command = state.selectionSummary.command;
            this._selectionSummaryStatusBarItem.show();
        } else {
            this._selectionSummaryStatusBarItem.hide();
        }
    }
}
