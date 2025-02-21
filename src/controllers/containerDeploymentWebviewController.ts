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
import { sqlAuthentication } from "../constants/constants";
import { IConnectionProfile } from "../models/interfaces";

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
            new cd.ContainerDeploymentWebviewState(),
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
        this.state.formState = getDefaultConnectionProfile();
        this.state.platform = platform();
        this.updateState();
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
    }

    private registerRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            if (payload.event.isAction) {
                // connect to profile
            } else {
                (this.state.formState[
                    payload.event.propertyName
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = payload.event.value;
            }

            return state;
        });
        this.registerReducer(
            "checkDockerInstallation",
            async (state, payload) => {
                const dockerInstallResult =
                    await this.checkDockerInstallation();
                let newState = state;
                if (!dockerInstallResult) {
                    newState.dockerInstallStatus.errorMessage =
                        "Docker not installed, please install and retry";
                    newState.dockerInstallStatus.loadState = ApiStatus.Error;
                    newState.dockerStatus.loadState = ApiStatus.Error;
                    newState.dockerEngineStatus.loadState = ApiStatus.Error;
                    return newState;
                }
                newState.dockerInstallStatus.loadState = ApiStatus.Loaded;
                return newState;
            },
        );
        this.registerReducer("startDocker", async (state, payload) => {
            const startDockerResult = await this.startDocker();
            let newState = state;
            if (!startDockerResult.success) {
                newState.dockerStatus.errorMessage =
                    "Failed to start Docker. Please manually start it, and then try again.";
                newState.dockerStatus.loadState = ApiStatus.Error;
                newState.dockerEngineStatus.loadState = ApiStatus.Error;
                return newState;
            }
            newState.dockerStatus.loadState = ApiStatus.Loaded;
            return newState;
        });
        this.registerReducer("checkLinuxEngine", async (state, payload) => {
            if (state.platform == "win32") {
                state.dockerEngineStatus.loadState = ApiStatus.Loaded;
                return state;
            }

            const checkLinuxEngineResult = await this.checkLinuxEngine();
            let newState = state;
            if (!checkLinuxEngineResult) {
                newState.dockerEngineStatus.errorMessage =
                    "Failed to prepare engine. Please switch to linux engine and try again.";
                newState.dockerEngineStatus.loadState = ApiStatus.Error;
                return newState;
            }
            newState.dockerStatus.loadState = ApiStatus.Loaded;
            return newState;
        });
        this.registerReducer(
            "validateContainerName",
            async (state, payload) => {
                state.isValidContainerName =
                    (await this.validateContainerName(payload.name)) !== "";
                return state;
            },
        );
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

    public async validateContainerName(containerName: string): Promise<string> {
        return new Promise((resolve) => {
            exec(cd.COMMANDS.VALIDATE_CONTAINER_NAME, (error, stdout) => {
                const existingContainers = stdout.trim().split("\n");

                let newContainerName: string = "";
                if (containerName.trim() == "") {
                    let newContainerName = "sql_server_container";
                    let counter = 1;

                    while (existingContainers.includes(newContainerName)) {
                        newContainerName = `sql_server_container${++counter}`;
                    }
                } else if (!existingContainers.includes(containerName)) {
                    newContainerName = containerName;
                }
                resolve(newContainerName);
            });
        });
    }

    public async addContainerConnection(
        dockerProfile: cd.DockerConnectionProfile,
    ): Promise<IConnectionProfile> {
        let connection: any = {
            ...dockerProfile,
            profileName: dockerProfile.user,
            savePassword: true,
            emptyPasswordInput: false,
            azureAuthType: undefined,
            accountStore: undefined,
            isValidProfile: () => true,
            isAzureActiveDirectory: () => false,
        };

        return await this.connectionManager.connectionUI.saveProfile(
            connection as IConnectionProfile,
        );
    }
}

export function getDefaultConnectionProfile(): cd.DockerConnectionProfile {
    const connection: any = {
        connectionString: undefined,
        profileName: "",
        encrypt: "Mandatory",
        trustServerCertificate: true,
        server: "",
        database: "",
        user: "SA",
        password: "",
        applicationName: "vscode-mssql",
        authenticationType: sqlAuthentication,
        savePassword: true,
        containerName: "",
        version: "2022",
        loadStatus: ApiStatus.Loading,
    };

    return connection;
}
