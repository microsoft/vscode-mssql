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
import { exists } from "../utils/utils";
import { homedir } from "os";
import { ApiStatus } from "../sharedInterfaces/webview";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { ExecutionPlanGraphInfo } from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { ExecutionPlanService } from "../services/executionPlanService";
import VscodeWrapper from "../controllers/vscodeWrapper";

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
            return await this._sqlOutputContentProvider.rowRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.rowStart,
                message.numberOfRows,
            );
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
            await this.createExecutionPlanGraphs(state, payload.xmlPlans);
            state.executionPlanState.loadState = ApiStatus.Loaded;
            state.tabStates.resultPaneTab =
                qr.QueryResultPaneTabs.ExecutionPlan;
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
            let folder = vscode.Uri.file(homedir());
            let filename: vscode.Uri;

            // make the default filename of the plan to be saved-
            // start at plan.sqlplan, then plan1.sqlplan, ...
            let counter = 1;
            if (await exists(`plan.sqlplan`, folder)) {
                while (await exists(`plan${counter}.sqlplan`, folder)) {
                    counter += 1;
                }
                filename = vscode.Uri.joinPath(
                    folder,
                    `plan${counter}.sqlplan`,
                );
            } else {
                filename = vscode.Uri.joinPath(folder, "plan.sqlplan");
            }

            // Show a save dialog to the user
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: filename,
                filters: {
                    "SQL Plan Files": ["sqlplan"],
                },
            });

            if (saveUri) {
                // Write the content to the new file
                void vscode.workspace.fs.writeFile(
                    saveUri,
                    Buffer.from(payload.sqlPlanContent),
                );
            }

            return state;
        });
        this.registerReducer("showPlanXml", async (state, payload) => {
            const planXmlDoc = await vscode.workspace.openTextDocument({
                content: payload.sqlPlanContent,
                language: "xml",
            });

            void vscode.window.showTextDocument(planXmlDoc);

            return state;
        });
        this.registerReducer("showQuery", async (state, payload) => {
            void this.untitledSqlDocumentService.newQuery(payload.query);

            return state;
        });
        this.registerReducer("updateTotalCost", async (state, payload) => {
            this.state.executionPlanState.totalCost += payload.addedCost;

            return {
                ...state,
                executionPlanState: {
                    ...state.executionPlanState,
                    totalCost: this.state.executionPlanState.totalCost,
                },
            };
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

    private async createExecutionPlanGraphs(
        state: qr.QueryResultWebviewState,
        xmlPlans: string[],
    ) {
        let newState = {
            ...state.executionPlanState,
        };
        for (const plan of xmlPlans) {
            const planFile: ExecutionPlanGraphInfo = {
                graphFileContent: plan,
                graphFileType: ".sqlplan",
            };
            try {
                newState.executionPlanGraphs =
                    newState.executionPlanGraphs.concat(
                        (
                            await this.executionPlanService.getExecutionPlan(
                                planFile,
                            )
                        ).graphs,
                    );

                newState.loadState = ApiStatus.Loaded;
            } catch (e) {
                newState.loadState = ApiStatus.Error;
                newState.errorMessage = e.toString();
            }
        }
        state.executionPlanState = newState;
        state.executionPlanState.totalCost = this.calculateTotalCost(state);
        this.updateState();
    }

    private calculateTotalCost(state: qr.QueryResultWebviewState): number {
        if (!state.executionPlanState.executionPlanGraphs) {
            state.executionPlanState.loadState = ApiStatus.Error;
            return 0;
        }

        let sum = 0;
        for (const graph of state.executionPlanState.executionPlanGraphs) {
            sum += graph.root.cost + graph.root.subTreeCost;
        }
        return sum;
    }
}
