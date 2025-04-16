/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../sharedInterfaces/containerDeploymentInterfaces";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import ConnectionManager from "./connectionManager";
import { exec } from "child_process";
import { platform } from "os";
import { sqlAuthentication } from "../constants/constants";
import { IConnectionProfile } from "../models/interfaces";
import { FormItemType, FormItemOptions, FormItemSpec } from "../sharedInterfaces/form";
import MainController from "./mainController";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "./vscodeWrapper";

export class ContainerDeploymentWebviewController extends FormWebviewController<
    cd.DockerConnectionProfile,
    cd.ContainerDeploymentWebviewState,
    cd.ContainerDeploymentFormItemSpec,
    cd.ContainerDeploymentReducers
> {
    requiredInputs: cd.ContainerDeploymentFormItemSpec[];
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
        this.state.formState = this.getDefaultConnectionProfile();
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
            // These fields are validated by running docker commands
            if (payload.event.propertyName == "containerName") {
                this.state.isValidContainerName =
                    (await validateContainerName(payload.event.value.toString())) !== "";
            }
            if (payload.event.propertyName == "port") {
                this.state.isValidPortNumber = await this.validatePort(
                    payload.event.value.toString(),
                );
            }
            await this.validateDockerConnectionProfile(
                this.state.formState,
                payload.event.propertyName,
            );

            return state;
        });
        this.registerReducer("checkDockerInstallation", async (state, _) => {
            if (state.dockerInstallStatus.loadState !== ApiStatus.Loading) return state;
            const dockerInstallResult = await checkDockerInstallation();
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
        });
        this.registerReducer("startDocker", async (state, payload) => {
            if (state.dockerStatus.loadState !== ApiStatus.Loading) return state;
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
        this.registerReducer("checkEngine", async (state, payload) => {
            if (state.dockerEngineStatus.loadState !== ApiStatus.Loading) return state;

            if (state.platform === "linux") {
                state.dockerEngineStatus.loadState = ApiStatus.Loaded;
                return state;
            }

            const checkEngineResult = await checkEngine();

            let newState = state;
            if (!checkEngineResult.success) {
                newState.dockerEngineStatus.errorMessage = checkEngineResult.error;

                newState.dockerEngineStatus.loadState = ApiStatus.Error;
                return newState;
            }

            newState.dockerEngineStatus.loadState = ApiStatus.Loaded;
            return newState;
        });

        this.registerReducer("checkDockerProfile", async (state, _) => {
            const errors = await this.validateDockerConnectionProfile(state.formState);
            state.isDockerProfileValid = errors.length === 0;
            return state;
        });
        this.registerReducer("startContainer", async (state, payload) => {
            if (state.dockerContainerCreationStatus.loadState !== ApiStatus.Loading) return state;
            if (this.state.formState.containerName.trim() == "") {
                this.state.formState.containerName = await validateContainerName(
                    this.state.formState.containerName,
                );
            }
            const startContainerResult = await startSqlServerDockerContainer(
                this.state.formState.containerName,
                this.state.formState.password,
                this.state.formState.version,
                this.state.formState.hostname,
                this.state.formState.port,
            );
            let newState = state;
            if (!startContainerResult.success) {
                newState.dockerContainerCreationStatus.errorMessage = "Failed to start container.";
                newState.dockerContainerCreationStatus.loadState = ApiStatus.Error;
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
            if (state.dockerContainerStatus.loadState !== ApiStatus.Loading) return state;
            const containerStatusResult = await checkIfContainerIsReadyForConnections(
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
            if (state.dockerConnectionStatus.loadState !== ApiStatus.Loading) return state;
            const connectionProfile = await this.addContainerConnection(state.formState);
            const connectionResult =
                await this.mainController.createObjectExplorerSession(connectionProfile);
            let newState = state;
            if (!connectionResult) {
                newState.dockerConnectionStatus.errorMessage = "Failed to connect to container.";
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

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: cd.ContainerDeploymentWebviewState,
    ): (keyof cd.DockerConnectionProfile)[] {
        return Object.keys(state.formComponents) as (keyof cd.DockerConnectionProfile)[];
    }

    async validatePort(port: string): Promise<boolean> {
        // No port chosen
        if (!port) return true;

        const portNumber = Number(port);

        // Check if portNumber is a valid number
        if (isNaN(portNumber) || portNumber <= 0) return false;

        const newPort = await findAvailablePort(portNumber);
        return newPort === portNumber;
    }

    async validateDockerConnectionProfile(
        dockerConnectionProfile: cd.DockerConnectionProfile,
        propertyName?: keyof cd.DockerConnectionProfile,
    ): Promise<string[]> {
        const erroredInputs: string[] = [];
        const components = propertyName
            ? [this.state.formComponents[propertyName]]
            : Object.values(this.state.formComponents);
        for (const component of components) {
            if (component && component.validate) {
                component.validation = component.validate(
                    this.state,
                    dockerConnectionProfile[component.propertyName],
                );
                if (!component.validation.isValid) {
                    erroredInputs.push(component.propertyName);
                }
            }
        }
        return erroredInputs;
    }

    async addContainerConnection(
        dockerProfile: cd.DockerConnectionProfile,
    ): Promise<IConnectionProfile> {
        let connection: any = {
            ...dockerProfile,
            profileName: dockerProfile.profileName || dockerProfile.containerName,
            savePassword: dockerProfile.savePassword,
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

    private getDefaultConnectionProfile(): cd.DockerConnectionProfile {
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
            savePassword: false,
            containerName: "",
            version: "2022",
            hostname: "",
            loadStatus: ApiStatus.Loading,
        };

        return connection;
    }

    private setFormComponents(): Record<
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
                label: "Select Image",
                required: true,
                isAdvancedOption: false,
                tooltip: "SQL Server Container Image Version",
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
                label: "Password",
                required: true,
                isAdvancedOption: false,
                tooltip: "SQL Server Container Password",
                validate(_, value) {
                    const testPassword = validateSqlServerPassword(value.toString());
                    if (testPassword === "") {
                        return { isValid: true, validationMessage: "" };
                    }
                    return {
                        isValid: false,
                        validationMessage: testPassword,
                    };
                },
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            savePassword: {
                type: FormItemType.Checkbox,
                propertyName: "savePassword",
                label: "Save Password",
                required: false,
                isAdvancedOption: false,
                tooltip: "Save Password",
                componentWidth: "350px",
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            profileName: {
                type: FormItemType.Input,
                propertyName: "profileName",
                label: "Connection Name",
                required: false,
                isAdvancedOption: false,
                tooltip: "Connection Name",
                validate(_, value) {
                    const profileNameValid =
                        value.toString() === "" || validateConnectionName(value.toString());
                    return {
                        isValid: profileNameValid,
                        validationMessage: profileNameValid
                            ? ""
                            : "Please choose a unique connection name",
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
                label: "Container Name",
                required: false,
                isAdvancedOption: true,
                tooltip: "Container Name",
                validate(containerDeploymentState, value) {
                    if (!value || value.toString() === "") {
                        return { isValid: true, validationMessage: "" };
                    }

                    return containerDeploymentState.isValidContainerName
                        ? { isValid: true, validationMessage: "" }
                        : {
                              isValid: false,
                              validationMessage: "Please use a unique container name",
                          };
                },
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            port: {
                type: FormItemType.Input,
                propertyName: "port",
                label: "Port",
                required: false,
                isAdvancedOption: true,
                tooltip: "Port",
                validate(containerDeploymentState, value) {
                    if (!value || value.toString() === "") {
                        return { isValid: true, validationMessage: "" };
                    }
                    return containerDeploymentState.isValidPortNumber
                        ? { isValid: true, validationMessage: "" }
                        : {
                              isValid: false,
                              validationMessage: "Please choose an available port",
                          };
                },
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            hostname: {
                type: FormItemType.Input,
                propertyName: "hostname",
                label: "Hostname",
                required: false,
                isAdvancedOption: true,
                tooltip: "Hostname",
            } as FormItemSpec<
                cd.DockerConnectionProfile,
                cd.ContainerDeploymentWebviewState,
                cd.ContainerDeploymentFormItemSpec
            >,

            acceptEula: {
                type: FormItemType.Checkbox,
                propertyName: "acceptEula",
                label: `<span>
                            Accept
                            <a
                                href="https://www.docker.com/legal/docker-subscription-service-agreement/"
                                target="_blank"
                            >
                                Terms & Conditions
                            </a>
                        </span>`,
                required: true,
                isAdvancedOption: false,
                tooltip: "Accept Terms and Conditions",
                componentWidth: "600px",
                validate(_, value) {
                    if (value) {
                        return { isValid: true, validationMessage: "" };
                    }
                    return {
                        isValid: false,
                        validationMessage: "Please accept the Terms and Conditions",
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

//#region Docker Functions

export function validateSqlServerPassword(password: string): string {
    if (password.length < 8) {
        return "Please make your password at least 8 characters long.";
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*]/.test(password);

    // Count the number of required character categories met
    const categoryCount = [hasUpperCase, hasLowerCase, hasDigit, hasSpecialChar].filter(
        Boolean,
    ).length;

    if (categoryCount < 3) {
        return "Your password must contain characters from at least three of the following categories: uppercase letters, lowercase letters, numbers (0-9), and special characters (!, $, #, %, etc.).";
    }

    return ""; // Return an empty string if the password is valid
}

export function validateConnectionName(connectionName: string): boolean {
    const connections = vscode.workspace.getConfiguration("mssql").get("connections", []);
    console.log(connections);
    console.log(connections[0].profileName);
    const isDuplicate = connections.some((profile) => profile.profileName === connectionName);
    return !isDuplicate;
}

export async function checkDockerInstallation(): Promise<boolean> {
    return new Promise((resolve) => {
        exec(cd.COMMANDS.CHECK_DOCKER, (error) => {
            resolve(!error);
        });
    });
}

export async function checkEngine(): Promise<cd.DockerCommandParams> {
    return new Promise((resolve) => {
        const engineCommand = cd.COMMANDS.CHECK_ENGINE[platform()];

        if (!engineCommand) {
            return resolve({
                success: false,
                error: `Unsupported platform for Docker: ${platform()}`,
            });
        }

        exec(engineCommand, (error) => {
            if (error) {
                return resolve({
                    success: false,
                    error:
                        platform() == "darwin"
                            ? "Please make sure Rosetta is turned on"
                            : "Please switch docker engine to linux containers",
                });
            }

            return resolve({
                success: true,
            });
        });
    });
}

export async function validateContainerName(containerName: string): Promise<string> {
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

export async function findAvailablePort(startPort: number): Promise<number> {
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
                        exec(`docker inspect ${containerId}`, (inspectError, inspectStdout) => {
                            if (!inspectError) {
                                const hostPortMatches =
                                    inspectStdout.match(/"HostPort":\s*"(\d+)"/g);
                                hostPortMatches?.forEach((match) =>
                                    usedPorts.add(Number(match.match(/\d+/)![0])),
                                );
                            } else {
                                console.error(
                                    `Error inspecting container ${containerId}: ${inspectError.message}`,
                                );
                            }
                            resolve();
                        });
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

export async function startSqlServerDockerContainer(
    containerName: string,
    password: string,
    version: string,
    hostname: string,
    port?: number,
): Promise<cd.DockerCommandParams> {
    const validatedPort = port ? port : await findAvailablePort(1433);
    console.log(
        cd.COMMANDS.START_SQL_SERVER(
            containerName,
            password,
            validatedPort,
            Number(version),
            hostname,
        ),
    );
    return new Promise((resolve) => {
        exec(
            cd.COMMANDS.START_SQL_SERVER(
                containerName,
                password,
                validatedPort,
                Number(version),
                hostname,
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
                console.log(`SQL Server container started on port ${port}.`);
                return resolve({
                    success: true,
                    port: validatedPort,
                });
            },
        );
    });
}

export async function isDockerContainerRunning(name: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(cd.COMMANDS.CHECK_CONTAINER_RUNNING(name), (error, stdout) => {
            resolve(!error && stdout.trim() === name);
        });
    });
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

export async function restartContainer(containerName: string): Promise<boolean> {
    const isDockerStarted = await startDocker();
    if (!isDockerStarted) return false;
    return new Promise((resolve) => {
        exec(cd.COMMANDS.START_CONTAINER(containerName), async (error) => {
            resolve(!error && (await checkIfContainerIsReadyForConnections(containerName)));
        });
    });
}

export async function checkIfContainerIsReadyForConnections(
    containerName: string,
): Promise<boolean> {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            exec(cd.COMMANDS.CHECK_LOGS(containerName, platform()), (error, stdout) => {
                if (!error && stdout.includes(cd.COMMANDS.CHECK_CONTAINER_READY)) {
                    clearInterval(interval);
                    resolve(true);
                }
            });
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

export async function stopContainer(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(cd.COMMANDS.STOP_CONTAINER(containerName), (error) => {
            if (error) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
}

// Returns container name if container is a Docker connection
export async function checkIfConnectionIsDockerContainer(serverName: string): Promise<string> {
    if (!serverName.includes("localhost") && !serverName.includes("127.0.0.1")) return "";

    return new Promise((resolve) => {
        exec(cd.COMMANDS.GET_CONTAINERS, (error, stdout) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return resolve("");
            }

            const containerIds = stdout.trim().split("\n").filter(Boolean);
            if (containerIds.length === 0) return resolve("");

            const inspections = containerIds.map(
                (containerId) =>
                    new Promise<string>((resolve) => {
                        exec(`docker inspect ${containerId}`, (inspectError, inspectStdout) => {
                            if (inspectError) {
                                console.error(
                                    `Error inspecting container ${containerId}: ${inspectError.message}`,
                                );
                                return resolve("");
                            }

                            const hostPortMatches = inspectStdout.match(/"HostPort":\s*"(\d+)"/g);
                            if (hostPortMatches) {
                                for (const match of hostPortMatches) {
                                    const portMatch = match.match(/\d+/);
                                    if (portMatch && serverName.includes(portMatch[0])) {
                                        const containerNameMatch =
                                            inspectStdout.match(/"Name"\s*:\s*"\/([^"]+)"/);
                                        if (containerNameMatch) {
                                            return resolve(containerNameMatch[1]); // Extract container name
                                        }
                                    }
                                }
                            }
                            resolve("");
                        });
                    }),
            );

            void Promise.all(inspections).then((results) => {
                const foundContainer = results.find((name) => name !== ""); // Get first valid container name
                resolve(foundContainer || ""); // Return container name or empty string if not found
            });
        });
    });
}

//#endregion
