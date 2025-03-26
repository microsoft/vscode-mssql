/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../reactviews/pages/ContainerDeployment/containerDeploymentInterfaces";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import ConnectionManager from "./connectionManager";
import { exec } from "child_process";
import { platform } from "os";
import { sqlAuthentication } from "../constants/constants";
import { IConnectionProfile } from "../models/interfaces";
import {
    FormItemType,
    FormItemOptions,
    FormItemSpec,
} from "../reactviews/common/forms/form";
import MainController from "./mainController";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "./vscodeWrapper";

export class ContainerDeploymentWebviewController extends FormWebviewController<
    cd.DockerConnectionProfile,
    cd.ContainerDeploymentWebviewState,
    cd.ContainerDeploymentFormItemSpec,
    cd.ContainerDeploymentReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
        public connectionManager: ConnectionManager,
    ) {
        super(
            context,
            vscodeWrapper,
            "containerDeployment",
            "containerDeployment",
            new cd.ContainerDeploymentWebviewState(),
            {
                title: `Deploy a local SQL Server Docker container`,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "connectionDialogEditor_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "connectionDialogEditor_light.svg",
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
        this.state.formComponents = this.setFormComponents();
        this.updateState();
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
    }

    private registerRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            (this.state.formState[
                payload.event.propertyName
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any) = payload.event.value;
            if (payload.event.propertyName == "containerName") {
                this.state.isValidContainerName =
                    (await this.validateContainerName(
                        payload.event.value.toString(),
                    )) !== "";
            }
            await this.validateDockerConnectionProfile(
                this.state.formState,
                payload.event.propertyName,
            );

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
            const startDockerResult = await startDocker();
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
        this.registerReducer("startContainer", async (state, payload) => {
            if (this.state.formState.containerName.trim() == "") {
                this.state.formState.containerName =
                    await this.validateContainerName(
                        this.state.formState.containerName,
                    );
            }
            const startContainerResult =
                await this.startSqlServerDockerContainer(
                    this.state.formState.containerName,
                    this.state.formState.password,
                    this.state.formState.version,
                );
            let newState = state;
            if (!startContainerResult.success) {
                newState.dockerContainerCreationStatus.errorMessage =
                    "Failed to start container.";
                newState.dockerContainerCreationStatus.loadState =
                    ApiStatus.Error;
                newState.dockerContainerStatus.loadState = ApiStatus.Error;
                newState.dockerConnectionStatus.loadState = ApiStatus.Error;
                return newState;
            }
            newState.formState.port = startContainerResult.port;
            newState.formState.server = `localhost, ${startContainerResult.port}`;
            newState.dockerContainerCreationStatus.loadState = ApiStatus.Loaded;
            return newState;
        });
        this.registerReducer("checkContainer", async (state, payload) => {
            const containerStatusResult =
                await checkIfContainerIsReadyForConnections(
                    this.state.formState.containerName,
                );
            let newState = state;
            if (!containerStatusResult) {
                newState.dockerContainerStatus.errorMessage =
                    "Failed to ready container for connections.";
                newState.dockerContainerStatus.loadState = ApiStatus.Error;
                newState.dockerConnectionStatus.loadState = ApiStatus.Error;
                return newState;
            }
            newState.dockerContainerStatus.loadState = ApiStatus.Loaded;
            return newState;
        });
        this.registerReducer("connectToContainer", async (state, payload) => {
            const connectionProfile = await this.addContainerConnection(
                state.formState,
            );
            const connectionResult =
                await this.mainController.createObjectExplorerSession(
                    connectionProfile,
                );
            let newState = state;
            if (!connectionResult) {
                newState.dockerConnectionStatus.errorMessage =
                    "Failed to connect to container.";
                return newState;
            }
            newState.dockerConnectionStatus.loadState = ApiStatus.Loaded;
            return newState;
        });
        this.registerReducer("dispose", async (state, payload) => {
            this.panel.dispose();
            this.dispose();
            return state;
        });
    }

    public async checkDockerInstallation(): Promise<boolean> {
        return new Promise((resolve) => {
            exec(cd.COMMANDS.CHECK_DOCKER, (error) => {
                resolve(!error);
            });
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: cd.ContainerDeploymentWebviewState,
    ): (keyof cd.DockerConnectionProfile)[] {
        return Object.keys(
            state.formComponents,
        ) as (keyof cd.DockerConnectionProfile)[];
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
                let existingContainers: string[] = [];
                if (stdout) {
                    existingContainers = stdout.trim().split("\n");
                }

                let newContainerName: string = "";
                if (containerName.trim() == "") {
                    newContainerName = "sql_server_container";
                    let counter = 1;

                    while (existingContainers.includes(newContainerName)) {
                        newContainerName = `sql_server_container_${++counter}`;
                    }
                } else if (
                    !existingContainers.includes(containerName) &&
                    /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)
                ) {
                    newContainerName = containerName;
                }
                resolve(newContainerName);
            });
        });
    }

    public async validateDockerConnectionProfile(
        dockerConnectionProfile: cd.DockerConnectionProfile,
        propertyName: keyof cd.DockerConnectionProfile,
    ): Promise<string[]> {
        const erroredInputs: string[] = [];
        const component = this.state.formComponents[propertyName];
        if (component && component.validate) {
            component.validation = component.validate(
                this.state,
                dockerConnectionProfile[propertyName],
            );
            if (!component.validation.isValid) {
                erroredInputs.push(component.propertyName);
            }
        }
        return erroredInputs;
    }

    async findAvailablePort(startPort: number): Promise<number> {
        return new Promise((resolve, reject) => {
            exec(cd.COMMANDS.GET_CONTAINERS, (error, stdout) => {
                if (error) {
                    console.error(`Error: ${error.message}`);
                    return reject(-1);
                }

                const containerIds = stdout.trim().split("\n").filter(Boolean);
                if (containerIds.length === 0) return resolve(startPort);

                const usedPorts: Set<number> = new Set();
                const inspections = containerIds.map(
                    (containerId) =>
                        new Promise<void>((resolve) => {
                            exec(
                                `docker inspect ${containerId}`,
                                (inspectError, inspectStdout) => {
                                    if (!inspectError) {
                                        const hostPortMatches =
                                            inspectStdout.match(
                                                /"HostPort":\s*"(\d+)"/g,
                                            );
                                        hostPortMatches?.forEach((match) =>
                                            usedPorts.add(
                                                Number(match.match(/\d+/)![0]),
                                            ),
                                        );
                                    } else {
                                        console.error(
                                            `Error inspecting container ${containerId}: ${inspectError.message}`,
                                        );
                                    }
                                    resolve();
                                },
                            );
                        }),
                );

                // @typescript-eslint/no-floating-promises
                void Promise.all(inspections).then(() => {
                    let port = startPort;
                    while (usedPorts.has(port)) port++;
                    resolve(port);
                });
            });
        });
    }

    public async startSqlServerDockerContainer(
        containerName: string,
        password: string,
        version: string,
    ): Promise<cd.DockerCommandParams> {
        const port = await this.findAvailablePort(1433);
        return new Promise((resolve) => {
            exec(
                cd.COMMANDS.START_SQL_SERVER(
                    containerName,
                    password,
                    port,
                    Number(version),
                ),
                async (error) => {
                    if (error) {
                        console.log(error);
                        return resolve({
                            success: false,
                            error: error.message,
                            port: undefined,
                        });
                    }
                    console.log(
                        `SQL Server container started on port ${port}.`,
                    );
                    return resolve({
                        success: true,
                        port: port,
                    });
                },
            );
        });
    }

    public async isDockerContainerRunning(name: string): Promise<boolean> {
        return new Promise((resolve) => {
            exec(cd.COMMANDS.CHECK_CONTAINER_RUNNING(name), (error, stdout) => {
                resolve(!error && stdout.trim() === name);
            });
        });
    }

    public async addContainerConnection(
        dockerProfile: cd.DockerConnectionProfile,
    ): Promise<IConnectionProfile> {
        let connection: any = {
            ...dockerProfile,
            profileName: dockerProfile.containerName,
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

    public setFormComponents(): Record<
        string,
        FormItemSpec<
            cd.DockerConnectionProfile,
            cd.ContainerDeploymentWebviewState,
            cd.ContainerDeploymentFormItemSpec
        >
    > {
        return {
            version: {
                type: FormItemType.Dropdown,
                propertyName: "version",
                label: "SQL Server Container Version",
                required: true,
                tooltip: "SQL Server Container Version",
                options: [
                    { displayName: "2022", value: "2022" },
                    { displayName: "2019", value: "2019" },
                    { displayName: "2017", value: "2017" },
                ] as FormItemOptions[],
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            password: {
                type: FormItemType.Password,
                propertyName: "password",
                label: "SQL Server Container Password",
                required: true,
                tooltip: "SQL Server Container Password",
                validate(_, value) {
                    if (validateSqlServerPassword(value.toString())) {
                        return { isValid: true, validationMessage: "" };
                    }
                    return {
                        isValid: false,
                        validationMessage:
                            "Please make your password at least 8 characters",
                    };
                },
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            containerName: {
                type: FormItemType.Input,
                propertyName: "containerName",
                label: "SQL Server Container Name",
                required: false,
                tooltip: "SQL Server Container Name",
                validate(containerDeploymentState, _) {
                    return containerDeploymentState.isValidContainerName
                        ? { isValid: true, validationMessage: "" }
                        : {
                              isValid: false,
                              validationMessage:
                                  "Please use a unique container name",
                          };
                },
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            acceptEula: {
                type: FormItemType.Checkbox,
                propertyName: "acceptEula",
                label: "Accept Docker Eula",
                required: true,
                tooltip: "Accept Docker Eula",
                validate(_, value) {
                    if (value) {
                        return { isValid: true, validationMessage: "" };
                    }
                    return {
                        isValid: false,
                        validationMessage: "Please accept the Docker Eula",
                    };
                },
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,
        };
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

export function validateSqlServerPassword(password: string): boolean {
    return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/.test(
        password,
    );
}

export async function startDocker(): Promise<cd.DockerCommandParams> {
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

export async function restartContainer(
    containerName: string,
): Promise<boolean> {
    const isDockerStarted = await startDocker();
    if (!isDockerStarted) return false;
    return new Promise((resolve) => {
        exec(cd.COMMANDS.START_CONTAINER(containerName), async (error) => {
            resolve(
                !error &&
                    (await checkIfContainerIsReadyForConnections(
                        containerName,
                    )),
            );
        });
    });
}

export async function checkIfContainerIsReadyForConnections(
    containerName: string,
): Promise<boolean> {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            exec(
                cd.COMMANDS.CHECK_LOGS(containerName, platform()),
                (error, stdout) => {
                    if (
                        !error &&
                        stdout.includes(cd.COMMANDS.CHECK_CONTAINER_READY)
                    ) {
                        clearInterval(interval);
                        resolve(true);
                    }
                },
            );
        }, 1000);
    });
}

export async function deleteContainer(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(cd.COMMANDS.DELETE_CONTAINER(containerName), (error) => {
            if (error) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
}
