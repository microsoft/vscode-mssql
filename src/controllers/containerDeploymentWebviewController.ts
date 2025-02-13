/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../reactviews/pages/ContainerDeployment/containerDeploymentInterfaces";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import ConnectionManager from "./connectionManager";

export class ContainerDeploymentWebviewController extends ReactWebviewPanelController<
    cd.ContainerDeploymentWebviewState,
    cd.ContainerDeploymentReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        public connectionManager: ConnectionManager,
    ) {
        super(
            context,
            "containerDeployment",
            {
                containerDeploymentState: {
                    loadState: ApiStatus.Loading,
                    containerName: "",
                    password: "",
                    port: 1433,
                    version: "2022",
                },
            },
            {
                title: `Deploy a local SQL Server Docker container`,
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
        this.state.containerDeploymentState.loadState = ApiStatus.Loading;
        this.updateState();
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("startDocker", async (state, payload) => {
            return {
                ...state,
                containerDeploymentState: {
                    ...state.containerDeploymentState,
                    loadState: ApiStatus.Loaded,
                },
            };
        });
    }
}
