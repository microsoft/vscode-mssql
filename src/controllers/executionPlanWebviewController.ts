/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewController";
import * as ep from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { homedir } from "os";
import { exists } from "../utils/utils";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import * as path from "path";
import { ApiStatus } from "../sharedInterfaces/webview";

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
            `${xmlPlanFileName}`, // Sets the webview title
            "executionPlan",
            {
                sqlPlanContent: executionPlanContents,
                theme:
                    vscode.window.activeColorTheme.kind ===
                    vscode.ColorThemeKind.Dark
                        ? "dark"
                        : "light",
                loadState: ApiStatus.Loading,
                executionPlan: undefined,
                executionPlanGraphs: [],
                totalCost: 0,
            },
            vscode.ViewColumn.Active,
            {
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
        );
        this.initialize();
    }

    private async initialize() {
        this.state.loadState = ApiStatus.Loading;
        this.updateState();
        await this.createExecutionPlanGraphs();
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("getExecutionPlan", async (state, payload) => {
            await this.createExecutionPlanGraphs();
            return {
                ...state,
                executionPlan: this.state.executionPlan,
                executionPlanGraphs: this.state.executionPlanGraphs,
            };
        });
        this.registerReducer("saveExecutionPlan", async (state, payload) => {
            let folder = vscode.Uri.file(homedir());
            if (await exists("Documents", folder)) {
                folder = vscode.Uri.file(path.join(folder.path, "Documents"));
            }

            let filename: vscode.Uri;
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
                await vscode.workspace.fs.writeFile(
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

            await vscode.window.showTextDocument(planXmlDoc);

            return state;
        });
        this.registerReducer("showQuery", async (state, payload) => {
            await this.untitledSqlDocumentService.newQuery(payload.query);

            return state;
        });
        this.registerReducer("updateTotalCost", async (state, payload) => {
            this.state.totalCost += payload.totalCost;

            return {
                ...state,
                totalCost: this.state.totalCost,
            };
        });
    }

    private async createExecutionPlanGraphs() {
        if (!this.state.executionPlan) {
            const planFile: ep.ExecutionPlanGraphInfo = {
                graphFileContent: this.executionPlanContents,
                graphFileType: ".sqlplan",
            };
            try {
                this.state.executionPlan =
                    await this.executionPlanService.getExecutionPlan(planFile);
                this.state.executionPlanGraphs =
                    this.state.executionPlan.graphs;
                this.state.loadState = ApiStatus.Loaded;
                this.state.totalCost = this.calculateTotalCost();
            } catch (e) {
                this.state.loadState = ApiStatus.Error;
                this.state.errorMessage = e.toString();
            }
        }
        this.updateState();
    }

    private calculateTotalCost(): number {
        let sum = 0;
        for (const graph of this.state.executionPlanGraphs!) {
            sum += graph.root.cost + graph.root.subTreeCost;
        }
        return sum;
    }
}
