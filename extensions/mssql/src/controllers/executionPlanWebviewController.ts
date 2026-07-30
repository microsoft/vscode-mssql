/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../sharedInterfaces/executionPlan";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import { WebviewPanelController } from "./webviewPanelController";
import SqlDocumentService from "./sqlDocumentService";
import {
    createExecutionPlanGraphs,
    openExecutionPlanComparisonWebview,
    saveExecutionPlan,
    showPlanXml,
    showQuery,
    updateTotalCost,
} from "./sharedExecutionPlanUtils";
import { ExecutionPlanService } from "../services/executionPlanService";
import {
    getPreviewConfigKey,
    isBetaExecutionPlanEnabled,
    PreviewFeature,
} from "../previews/previewService";
import { executionPlanSourceRegistry } from "./executionPlanSourceRegistry";

export class ExecutionPlanWebviewController extends WebviewPanelController<
    ep.ExecutionPlanWebviewState,
    ep.ExecutionPlanReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        public executionPlanService: ExecutionPlanService, // public for testing purposes
        public sqlDocumentService: SqlDocumentService,
        public executionPlanContents: string,
        // needs ts-ignore because linter doesn't recognize that fileName is being used in the call to super
        // @ts-ignore
        xmlPlanFileName: string,
    ) {
        super(
            context,
            "executionPlan",
            "executionPlan",
            {
                executionPlanState: {
                    loadState: ApiStatus.Loading,
                    executionPlanGraphs: [],
                    totalCost: 0,
                    isBetaExecutionPlanEnabled: isBetaExecutionPlanEnabled(),
                },
            },
            {
                title: `${xmlPlanFileName}`, // Sets the webview title
                viewColumn: vscode.ViewColumn.Active, // Sets the view column of the webview
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_light.svg",
                    ),
                },
            },
        );
        this.registerDisposable(
            executionPlanSourceRegistry.register(xmlPlanFileName, executionPlanContents),
        );
        void this.initialize();
    }

    private async initialize() {
        this.state.executionPlanState.loadState = ApiStatus.Loading;
        this.updateState();
        this.registerRpcHandlers();
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(
                        getPreviewConfigKey(PreviewFeature.BetaExecutionPlan),
                    )
                ) {
                    this.updateState({
                        ...this.state,
                        executionPlanState: {
                            ...this.state.executionPlanState,
                            isBetaExecutionPlanEnabled: isBetaExecutionPlanEnabled(),
                        },
                    });
                }
            }),
        );
    }

    private registerRpcHandlers() {
        this.registerReducer("getExecutionPlan", async (state, _payload) => {
            state = await createExecutionPlanGraphs(
                state,
                this.executionPlanService,
                [this.executionPlanContents],
                "SqlplanFile",
            );
            return {
                ...state,
                executionPlanState: {
                    ...state.executionPlanState,
                    isBetaExecutionPlanEnabled:
                        this.state.executionPlanState.isBetaExecutionPlanEnabled,
                },
            };
        });
        this.registerReducer("saveExecutionPlan", async (state, payload) => {
            return saveExecutionPlan(state, payload);
        });
        this.registerReducer("showPlanXml", async (state, payload) => {
            return showPlanXml(state, payload);
        });
        this.registerReducer("showQuery", async (state, payload) => {
            return showQuery(state, payload, this.sqlDocumentService);
        });
        this.registerReducer("updateTotalCost", async (state, payload) => {
            return updateTotalCost(state, payload);
        });
        this.registerReducer("compareExecutionPlan", async (state, payload) => {
            if (
                state.executionPlanState.isReactFlowExecutionPlanEnabled &&
                state.executionPlanState.executionPlanGraphs?.length
            ) {
                openExecutionPlanComparisonWebview(
                    this._context,
                    this.executionPlanService,
                    state.executionPlanState.executionPlanGraphs,
                    payload.graphIndex,
                    this.panel.title,
                );
            }
            return state;
        });
        this.registerReducer("selectComparisonPlan", async (state) => state);
        this.registerReducer("setComparisonGraphIndexes", async (state) => state);
    }
}
