/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
// import * as Constants from "../constants/constants";
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
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { QueryResultWebviewController } from "./queryResultWebViewController";
import {
    createExecutionPlanGraphs,
    saveExecutionPlan,
    showPlanXml,
    showQuery,
    updateTotalCost,
} from "../controllers/sharedExecutionPlanUtils";

export class QueryResultWebviewPanelController extends ReactWebviewPanelController<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
> {
    private _sqlOutputContentProvider: SqlOutputContentProvider;
    private _correlationId: string = randomUUID();

    constructor(
        context: vscode.ExtensionContext,
        private _executionPlanService: ExecutionPlanService,
        private _untitledSqlDocumentService: UntitledSqlDocumentService,
        private _vscodeWrapper: VscodeWrapper,
        private _viewColumn: vscode.ViewColumn,
        private _uri: string,
        private _queryResultWebviewViewController: QueryResultWebviewController,
    ) {
        super(
            context,
            "queryResult",
            {
                resultSetSummaries: {},
                messages: [],
                tabStates: {
                    resultPaneTab: qr.QueryResultPaneTabs.Messages,
                },
                executionPlanState: {},
            },
            {
                title: _uri,
                viewColumn: _viewColumn,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "revealQueryResult.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "revealQueryResult.svg",
                    ),
                },
            },
        );

        void this.initialize();
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
    }

    private async initialize() {
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerRequestHandler("getWebviewLocation", async () => {
            return qr.QueryResultWebviewLocation.Document;
        });
        this.registerRequestHandler("getRows", async (message) => {
            const result =
                await this._sqlOutputContentProvider.rowRequestHandler(
                    message.uri,
                    message.batchId,
                    message.resultId,
                    message.rowStart,
                    message.numberOfRows,
                );
            let currentState =
                this._queryResultWebviewViewController.getQueryResultState(
                    message.uri,
                );
            if (currentState.isExecutionPlan) {
                currentState.executionPlanState.xmlPlans =
                    // this gets the xml plan returned by the get execution
                    // plan query
                    currentState.executionPlanState.xmlPlans.concat(
                        result.rows[0][0].displayValue,
                    );
            }
            this._queryResultWebviewViewController.setQueryResultState(
                message.uri,
                currentState,
            );
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
            // because this is an overridden call, this makes sure it is being
            // called properly
            if ("uri" in payload) {
                const currentResultState =
                    this._queryResultWebviewViewController.getQueryResultState(
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
                                this._queryResultWebviewViewController.getNumExecutionPlanResultSets(
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
                    this._executionPlanService,
                    currentResultState.executionPlanState.xmlPlans,
                )) as qr.QueryResultWebviewState;
                state.executionPlanState.loadState = ApiStatus.Loaded;
                state.tabStates.resultPaneTab =
                    qr.QueryResultPaneTabs.ExecutionPlan;

                return state;
            }
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
                this._untitledSqlDocumentService,
            )) as qr.QueryResultWebviewState;
        });
        this.registerReducer("updateTotalCost", async (state, payload) => {
            return (await updateTotalCost(
                state,
                payload,
            )) as qr.QueryResultWebviewState;
        });
    }

    public override extraDispose(): void {
        this._queryResultWebviewViewController.removePanel(this._uri);
    }

    public revealToForeground() {
        this.panel.reveal(this._viewColumn);
    }

    public setSqlOutputContentProvider(
        provider: SqlOutputContentProvider,
    ): void {
        this._sqlOutputContentProvider = provider;
    }
}
