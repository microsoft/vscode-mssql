/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
import * as Constants from "../constants/constants";
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
    private _sqlOutputContentProvider: SqlOutputContentProvider;
    private _correlationId: string = randomUUID();

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

    private registerRpcHandlers() {
        this.registerRequestHandler("getRows", async (message) => {
            const result =
                await this._sqlOutputContentProvider.rowRequestHandler(
                    message.uri,
                    message.batchId,
                    message.resultId,
                    message.rowStart,
                    message.numberOfRows,
                );
            let currentState = this.getQueryResultState(message.uri);
            if (currentState.isExecutionPlan) {
                currentState.executionPlanState.xmlPlans =
                    // this gets the xml plan returned by the get execution
                    // plan query
                    currentState.executionPlanState.xmlPlans.concat(
                        result.rows[0][0].displayValue,
                    );
            }
            this._queryResultStateMap.set(message.uri, currentState);
            return result;
        });
        this.registerRequestHandler("setEditorSelection", async (message) => {
            return await this._sqlOutputContentProvider.editorSelectionRequestHandler(
                message.uri,
                message.selectionData,
            );
        });
        this.registerRequestHandler("saveResults", async (message) => {
            sendActionEvent(
                TelemetryViews.QueryResult,
                TelemetryActions.SaveResults,
                {
                    correlationId: this._correlationId,
                    format: message.format,
                    selection: message.selection,
                    origin: message.origin,
                },
            );
            return await this._sqlOutputContentProvider.saveResultsRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.format,
                message.selection,
            );
        });
        this.registerRequestHandler("copySelection", async (message) => {
            sendActionEvent(
                TelemetryViews.QueryResult,
                TelemetryActions.CopyResults,
                {
                    correlationId: this._correlationId,
                },
            );
            return await this._sqlOutputContentProvider.copyRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
        });
        this.registerRequestHandler("copyWithHeaders", async (message) => {
            sendActionEvent(
                TelemetryViews.QueryResult,
                TelemetryActions.CopyResultsHeaders,
                {
                    correlationId: this._correlationId,
                },
            );
            return await this._sqlOutputContentProvider.copyRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
                true, //copy headers flag
            );
        });
        this.registerRequestHandler("copyHeaders", async (message) => {
            sendActionEvent(
                TelemetryViews.QueryResult,
                TelemetryActions.CopyHeaders,
                {
                    correlationId: this._correlationId,
                },
            );
            return await this._sqlOutputContentProvider.copyHeadersRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
        });
        this.registerReducer("setResultTab", async (state, payload) => {
            state.tabStates.resultPaneTab = payload.tabId;
            return state;
        });
        this.registerReducer("getExecutionPlan", async (state, payload) => {
            const currentResultState = this.getQueryResultState(payload.uri);
            if (
                // in the case of a multi-set result set, make sure the
                // results have fully finished loading by checking that
                // we have the same amount of xml plans as result sets
                currentResultState.executionPlanState.xmlPlans.length &&
                currentResultState.executionPlanState.xmlPlans.length ===
                    Object.keys(currentResultState.resultSetSummaries).length &&
                currentResultState.executionPlanState.executionPlanGraphs
                    .length === 0
            ) {
                state = (await createExecutionPlanGraphs(
                    state,
                    this.executionPlanService,
                    currentResultState.executionPlanState.xmlPlans,
                )) as qr.QueryResultWebviewState;
                state.executionPlanState.loadState = ApiStatus.Loaded;
                state.tabStates.resultPaneTab =
                    qr.QueryResultPaneTabs.ExecutionPlan;
            }
            return state;
        });
        this.registerReducer("addXmlPlan", async (state, payload) => {
            state.executionPlanState.xmlPlans = [
                ...state.executionPlanState.xmlPlans,
                payload.xmlPlan,
            ];
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
    }

    public addQueryResultState(uri: string, isExecutionPlan?: boolean): void {
        let currentState = {
            resultSetSummaries: {},
            messages: [],
            tabStates: {
                resultPaneTab: qr.QueryResultPaneTabs.Messages,
            },
            uri: uri,
            isExecutionPlan: isExecutionPlan,
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

    public setExecutionPlanService(service: ExecutionPlanService): void {
        this.executionPlanService = service;
    }

    public setUntitledDocumentService(
        service: UntitledSqlDocumentService,
    ): void {
        this.untitledSqlDocumentService = service;
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
}
