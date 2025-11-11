/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../sharedInterfaces/executionPlan";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import SqlDocumentService from "./sqlDocumentService";
import {
    createExecutionPlanGraphs,
    saveExecutionPlan,
    showPlanXml,
    showQuery,
    updateTotalCost,
} from "./sharedExecutionPlanUtils";
import { ExecutionPlanService } from "../services/executionPlanService";
import VscodeWrapper from "./vscodeWrapper";

export class ExecutionPlanWebviewController extends ReactWebviewPanelController<
    ep.ExecutionPlanWebviewState,
    ep.ExecutionPlanReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        public executionPlanService: ExecutionPlanService, // public for testing purposes
        public sqlDocumentService: SqlDocumentService,
        public executionPlanContents: string,
        // needs ts-ignore because linter doesn't recognize that fileName is being used in the call to super
        // @ts-ignore
        xmlPlanFileName: string,
    ) {
        super(
            context,
            vscodeWrapper,
            "executionPlan",
            "executionPlan",
            {
                executionPlanState: {
                    loadState: ApiStatus.Loading,
                    executionPlanGraphs: [],
                    totalCost: 0,
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
        void this.initialize();
    }

    private async initialize() {
        this.state.executionPlanState.loadState = ApiStatus.Loading;
        this.updateState();
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("getExecutionPlan", async (state, payload) => {
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
                    executionPlanGraphs: this.state.executionPlanState.executionPlanGraphs,
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
    }
}
