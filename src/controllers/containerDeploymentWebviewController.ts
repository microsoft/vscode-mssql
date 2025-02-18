/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../reactviews/pages/ContainerDeployment/containerDeploymentInterfaces";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import ConnectionManager from "./connectionManager";
import { exec } from "child_process";
import { platform } from "os";

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
                loadState: ApiStatus.Loading,
                containerDeploymentState: {
                    dockerInstallStatus: {
                        loadState: ApiStatus.Loading,
                    },
                    dockerStatus: {
                        loadState: ApiStatus.Loading,
                    },
                    dockerEngineStatus: {
                        loadState: ApiStatus.Loading,
                    },
                    containerStatus: {
                        loadState: ApiStatus.Loading,
                        containerName: "",
                        password: "",
                        version: "2022",
                        port: 1433,
                    },
                    platform: platform(),
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
        this.state.loadState = ApiStatus.Loading;
        this.updateState();
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
    }

    private registerRpcHandlers() {
        this.registerReducer(
            "checkDockerInstallation",
            async (state, payload) => {
                const dockerInstallResult =
                    await this.checkDockerInstallation();
                let newState = state;
                if (!dockerInstallResult) {
                    newState.containerDeploymentState.dockerInstallStatus.errorMessage =
                        "Docker not installed, please install and retry";
                    newState.containerDeploymentState.dockerInstallStatus.loadState =
                        ApiStatus.Error;
                    newState.containerDeploymentState.dockerStatus.loadState =
                        ApiStatus.Error;
                    newState.containerDeploymentState.dockerEngineStatus.loadState =
                        ApiStatus.Error;
                    return newState;
                }
                newState.containerDeploymentState.dockerInstallStatus.loadState =
                    ApiStatus.Loaded;
                return newState;
            },
        );
        this.registerReducer("startDocker", async (state, payload) => {
            const startDockerResult = await this.startDocker();
            let newState = state;
            if (!startDockerResult.success) {
                newState.containerDeploymentState.dockerStatus.errorMessage =
                    "Failed to start Docker. Please manually start it, and then try again.";
                newState.containerDeploymentState.dockerStatus.loadState =
                    ApiStatus.Error;
                newState.containerDeploymentState.dockerEngineStatus.loadState =
                    ApiStatus.Error;
                return newState;
            }
            newState.containerDeploymentState.dockerStatus.loadState =
                ApiStatus.Loaded;
            return newState;
        });
        this.registerReducer("checkLinuxEngine", async (state, payload) => {
            if (state.containerDeploymentState.platform == "win32") {
                state.containerDeploymentState.dockerEngineStatus.loadState =
                    ApiStatus.Loaded;
                return state;
            }

            const checkLinuxEngineResult = await this.checkLinuxEngine();
            let newState = state;
            if (!checkLinuxEngineResult) {
                newState.containerDeploymentState.dockerEngineStatus.errorMessage =
                    "Failed to prepare engine. Please switch to linux engine and try again.";
                newState.containerDeploymentState.dockerEngineStatus.loadState =
                    ApiStatus.Error;
                return newState;
            }
            newState.containerDeploymentState.dockerStatus.loadState =
                ApiStatus.Loaded;
            return newState;
        });
    }

    public async checkDockerInstallation(): Promise<boolean> {
        return new Promise((resolve) => {
            exec(cd.COMMANDS.CHECK_DOCKER, (error) => {
                resolve(!error);
            });
        });
    }

    public async startDocker(): Promise<cd.DockerCommandParams> {
        return new Promise((resolve) => {
            const startCommand = cd.COMMANDS.START_DOCKER[platform()];

            if (!startCommand) {
                return resolve({
                    success: false,
                    error: `Unsupported platform for Docker: ${platform()}`,
                });
            }

            exec(startCommand, (err) => {
                if (err) return resolve({ success: false, error: err.message });
                console.log("Docker started. Waiting for initialization...");

                let attempts = 0;
                const maxAttempts = 30;
                const interval = 2000;

                const checkDocker = setInterval(() => {
                    exec(cd.COMMANDS.CHECK_DOCKER, (err) => {
                        if (!err) {
                            clearInterval(checkDocker);
                            return resolve({ success: true });
                        }
                        if (++attempts >= maxAttempts) {
                            clearInterval(checkDocker);
                            return resolve({
                                success: false,
                                error: "Docker failed to start within the timeout period.",
                            });
                        }
                    });
                }, interval);
            });
        });
    }

    public async checkLinuxEngine(): Promise<boolean> {
        return new Promise((resolve) => {
            exec(cd.COMMANDS.SWITCH_LINUX_ENGINE, (error) => {
                resolve(!error);
            });
        });
    }
}
