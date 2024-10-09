/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
import { ReactWebviewViewController } from "../controllers/reactWebviewViewController";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import { exists } from "../utils/utils";
import { homedir } from "os";
import { ApiStatus } from "../sharedInterfaces/webview";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { ExecutionPlanGraphInfo } from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { ExecutionPlanService } from "../services/executionPlanService";

export class QueryResultWebviewController extends ReactWebviewViewController<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
> {
    private _queryResultStateMap: Map<string, qr.QueryResultWebviewState> =
        new Map<string, qr.QueryResultWebviewState>();
    private _sqlOutputContentProvider: SqlOutputContentProvider;

    constructor(
        context: vscode.ExtensionContext,
        private executionPlanService: ExecutionPlanService,
        private untitledSqlDocumentService: UntitledSqlDocumentService,
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
    }

    private async initialize() {
        this.registerRpcHandlers();
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
            return await this._sqlOutputContentProvider.saveResultsRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.format,
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
            // start ad plan.sqlplan, then plan1.sqlplan, ...
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
                    sqlPlanContent: "",
                    theme:
                        vscode.window.activeColorTheme.kind ===
                        vscode.ColorThemeKind.Dark
                            ? "dark"
                            : "light",
                    executionPlan: undefined,
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

    private async createExecutionPlanGraphs(
        state: qr.QueryResultWebviewState,
        xmlPlans: string[],
    ) {
        for (const plan of xmlPlans) {
            const planFile: ExecutionPlanGraphInfo = {
                graphFileContent: plan,
                graphFileType: ".sqlplan",
            };
            try {
                state.executionPlanState.executionPlan =
                    await this.executionPlanService.getExecutionPlan(planFile);
                state.executionPlanState.executionPlanGraphs =
                    state.executionPlanState.executionPlanGraphs.concat(
                        state.executionPlanState.executionPlan.graphs,
                    );
                state.executionPlanState.loadState = ApiStatus.Loaded;
            } catch (e) {
                state.executionPlanState.loadState = ApiStatus.Error;
                state.executionPlanState.errorMessage = e.toString();
            }
        }
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
