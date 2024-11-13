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
import {
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { randomUUID } from "crypto";
import { ApiStatus } from "../sharedInterfaces/webview";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { ExecutionPlanService } from "../services/executionPlanService";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { QueryResultWebviewPanelController } from "./queryResultWebviewPanelController";
import {
    getNewResultPaneViewColumn,
    registerCommonRequestHandlers,
} from "./utils";
import {
    createExecutionPlanGraphs,
    saveExecutionPlan,
    showPlanXml,
    showQuery,
    updateTotalCost,
} from "../controllers/sharedExecutionPlanUtils";

export class QueryResultWebviewController extends ReactWebviewViewController<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
> {
    private _queryResultStateMap: Map<string, qr.QueryResultWebviewState> =
        new Map<string, qr.QueryResultWebviewState>();
    private _queryResultWebviewPanelControllerMap: Map<
        string,
        QueryResultWebviewPanelController
    > = new Map<string, QueryResultWebviewPanelController>();
    private _sqlOutputContentProvider: SqlOutputContentProvider;
    private _correlationId: string = randomUUID();
    public actualPlanStatuses: string[] = [];

    constructor(
        context: vscode.ExtensionContext,
        private executionPlanService: ExecutionPlanService,
        private untitledSqlDocumentService: UntitledSqlDocumentService,
        private _vscodeWrapper: VscodeWrapper,
    ) {
        super(context, "queryResult", {
            resultSetSummaries: {},
            messages: [],
            tabStates: {
                resultPaneTab: qr.QueryResultPaneTabs.Messages,
            },
            executionPlanState: {},
        });

        void this.initialize();
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
        if (this.isRichExperiencesEnabled) {
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
                    };
                }
            });

            // not the best api but it's the best we can do in VSCode
            this._vscodeWrapper.onDidOpenTextDocument((document) => {
                const uri = document.uri.toString(true);
                if (this._queryResultStateMap.has(uri)) {
                    this._queryResultStateMap.delete(uri);
                }
            });
        }
    }

    private async initialize() {
        this.registerRpcHandlers();
    }

    private get isRichExperiencesEnabled(): boolean {
        return this._vscodeWrapper
            .getConfiguration()
            .get(Constants.configEnableRichExperiences);
    }

    private get isOpenQueryResultsInTabByDefaultEnabled(): boolean {
        return this._vscodeWrapper
            .getConfiguration()
            .get(Constants.configOpenQueryResultsInTabByDefault);
    }

    private get isDefaultQueryResultToDocumentDoNotShowPromptEnabled(): boolean {
        return this._vscodeWrapper
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
        this.registerRequestHandler("openInNewTab", async (message) => {
            if (this.shouldShowDefaultQueryResultToDocumentPrompt) {
                const response =
                    await this._vscodeWrapper.showInformationMessage(
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
                    await this._vscodeWrapper
                        .getConfiguration()
                        .update(
                            Constants.configOpenQueryResultsInTabByDefault,
                            true,
                            vscode.ConfigurationTarget.Global,
                        );
                }
                // show the prompt only once
                await this._vscodeWrapper
                    .getConfiguration()
                    .update(
                        Constants.configOpenQueryResultsInTabByDefaultDoNotShowPrompt,
                        true,
                        vscode.ConfigurationTarget.Global,
                    );
            }
            await this.createPanelController(message.uri);
        });
        this.registerReducer("getExecutionPlan", async (state, payload) => {
            // because this is an overridden call, this makes sure it is being
            // called properly
            if ("uri" in payload) {
                const currentResultState = this.getQueryResultState(
                    payload.uri,
                );
                if (
                    !(
                        // Check if actual plan is enabled or current result is an execution plan
                        (
                            (currentResultState.actualPlanEnabled ||
                                currentResultState.isExecutionPlan) &&
                            // Ensure execution plan state exists and execution plan graphs have not loaded
                            currentResultState.executionPlanState &&
                            currentResultState.executionPlanState
                                .executionPlanGraphs.length === 0 &&
                            // Check for non-empty XML plans and result summaries
                            currentResultState.executionPlanState.xmlPlans
                                .length &&
                            Object.keys(currentResultState.resultSetSummaries)
                                .length &&
                            // Verify XML plans match expected number of result sets
                            currentResultState.executionPlanState.xmlPlans
                                .length ===
                                this.getNumExecutionPlanResultSets(
                                    currentResultState.resultSetSummaries,
                                    currentResultState.actualPlanEnabled,
                                )
                        )
                    )
                ) {
                    return state;
                }

                state = (await createExecutionPlanGraphs(
                    state,
                    this.executionPlanService,
                    currentResultState.executionPlanState.xmlPlans,
                )) as qr.QueryResultWebviewState;
                state.executionPlanState.loadState = ApiStatus.Loaded;
                state.tabStates.resultPaneTab =
                    qr.QueryResultPaneTabs.ExecutionPlan;

                return state;
            }
        });
        this.registerReducer("openFileThroughLink", async (state, payload) => {
            // TO DO: add formatting? ADS doesn't do this, but it may be nice...
            // git issue #18396
            const newDoc = await vscode.workspace.openTextDocument({
                content: payload.content,
                language: payload.type,
            });

            void vscode.window.showTextDocument(newDoc);

            return state;
        });
        this.registerReducer("saveExecutionPlan", async (state, payload) => {
            return (await saveExecutionPlan(
                state,
                payload,
            )) as qr.QueryResultWebviewState;
        });
        this.registerReducer("showPlanXml", async (state, payload) => {
            return (await showPlanXml(
                state,
                payload,
            )) as qr.QueryResultWebviewState;
        });
        this.registerReducer("showQuery", async (state, payload) => {
            return (await showQuery(
                state,
                payload,
                this.untitledSqlDocumentService,
            )) as qr.QueryResultWebviewState;
        });
        this.registerReducer("updateTotalCost", async (state, payload) => {
            return (await updateTotalCost(
                state,
                payload,
            )) as qr.QueryResultWebviewState;
        });
        this.registerRequestHandler("getWebviewLocation", async () => {
            return qr.QueryResultWebviewLocation.Panel;
        });
        registerCommonRequestHandlers(this, this._correlationId);
    }

    public async createPanelController(uri: string) {
        const viewColumn = getNewResultPaneViewColumn(uri, this._vscodeWrapper);
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap
                .get(uri)
                .revealToForeground();
            return;
        }

        const controller = new QueryResultWebviewPanelController(
            this._context,
            this._vscodeWrapper,
            viewColumn,
            uri,
            this._queryResultStateMap.get(uri).title,
            this,
        );
        controller.state = this.getQueryResultState(uri);
        controller.revealToForeground();
        this._queryResultWebviewPanelControllerMap.set(uri, controller);
        if (this.isVisible()) {
            await vscode.commands.executeCommand(
                "workbench.action.togglePanel",
            );
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
                    xmlPlans: [],
                },
            }),
        };
        this._queryResultStateMap.set(uri, currentState);
    }

    public setQueryResultState(uri: string, state: qr.QueryResultWebviewState) {
        this._queryResultStateMap.set(uri, state);
    }

    public updatePanelState(uri: string): void {
        if (this._queryResultWebviewPanelControllerMap.has(uri)) {
            this._queryResultWebviewPanelControllerMap
                .get(uri)
                .updateState(this.getQueryResultState(uri));
            this._queryResultWebviewPanelControllerMap
                .get(uri)
                .revealToForeground();
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
            throw new Error(`No query result state found for uri ${uri}`);
        }
        return res;
    }

    public addResultSetSummary(
        uri: string,
        resultSetSummary: qr.ResultSetSummary,
    ) {
        let state = this.getQueryResultState(uri);
        const batchId = resultSetSummary.batchId;
        const resultId = resultSetSummary.id;
        if (!state.resultSetSummaries[batchId]) {
            state.resultSetSummaries[batchId] = {};
        }
        state.resultSetSummaries[batchId][resultId] = resultSetSummary;
    }

    public setSqlOutputContentProvider(
        provider: SqlOutputContentProvider,
    ): void {
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

    public setUntitledDocumentService(
        service: UntitledSqlDocumentService,
    ): void {
        this.untitledSqlDocumentService = service;
    }

    public getUntitledDocumentService(): UntitledSqlDocumentService {
        return this.untitledSqlDocumentService;
    }

    public async copyAllMessagesToClipboard(uri: string): Promise<void> {
        const messages = uri
            ? this.getQueryResultState(uri)?.messages?.map(
                  (message) => message.message,
              )
            : this.state?.messages?.map((message) => message.message);

        if (!messages) {
            return;
        }

        const messageText = messages.join("\n");
        await this._vscodeWrapper.clipboardWriteText(messageText);
    }

    public getNumExecutionPlanResultSets(
        resultSetSummaries: qr.QueryResultWebviewState["resultSetSummaries"],
        actualPlanEnabled: boolean,
    ): number {
        const summariesLength = Object.keys(resultSetSummaries).length;
        if (!actualPlanEnabled) {
            return summariesLength;
        }
        // count the amount of xml showplans in the result summaries
        let total = 0;
        Object.values(resultSetSummaries).forEach((batch) => {
            Object.values(batch).forEach((result) => {
                // Check if any column in columnInfo has the specific column name
                if (
                    result.columnInfo[0].columnName ===
                    Constants.showPlanXmlColumnName
                ) {
                    total++;
                }
            });
        });
        return total;
    }
}
