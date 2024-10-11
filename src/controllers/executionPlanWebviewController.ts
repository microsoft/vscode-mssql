/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import * as vscode from "vscode";

import { ApiStatus } from "../sharedInterfaces/webview";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { exists } from "../utils/utils";
import { homedir } from "os";
import { sqlPlanFileExtension } from "../constants/constants";

export class ExecutionPlanWebviewController extends ReactWebviewPanelController<
    ep.ExecutionPlanWebviewState,
    ep.ExecutionPlanReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        private executionPlanService: ep.ExecutionPlanService,
        private untitledSqlDocumentService: UntitledSqlDocumentService,
        private executionPlanContents: string,
        // needs ts-ignore because linter doesn't recognize that fileName is being used in the call to super
        // @ts-ignore
        private xmlPlanFileName: string,
    ) {
        super(
            context,
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
        await this.createExecutionPlanGraphs(this.executionPlanContents);
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("getExecutionPlan", async (state, payload) => {
            await this.createExecutionPlanGraphs(payload.sqlPlanContent);
            return {
                ...state,
                executionPlanState: {
                    ...state.executionPlanState,
                    executionPlanGraphs:
                        this.state.executionPlanState.executionPlanGraphs,
                },
            };
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

    private async createExecutionPlanGraphs(content: string) {
        const planFile: ep.ExecutionPlanGraphInfo = {
            graphFileContent: content,
            graphFileType: sqlPlanFileExtension,
        };
        try {
            this.state.executionPlanState.executionPlanGraphs = (
                await this.executionPlanService.getExecutionPlan(planFile)
            ).graphs;
            this.state.executionPlanState.loadState = ApiStatus.Loaded;
            this.state.executionPlanState.totalCost = this.calculateTotalCost();
        } catch (e) {
            this.state.executionPlanState.loadState = ApiStatus.Error;
            this.state.executionPlanState.errorMessage = e.toString();
        }
        this.updateState();
    }

    private calculateTotalCost(): number {
        if (!this.state.executionPlanState.executionPlanGraphs) {
            this.state.executionPlanState.loadState = ApiStatus.Error;
            return 0;
        }

        let sum = 0;
        for (const graph of this.state.executionPlanState.executionPlanGraphs) {
            sum += graph.root.cost + graph.root.subTreeCost;
        }
        return sum;
    }
}
