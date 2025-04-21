/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../sharedInterfaces/containerDeploymentInterfaces";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import ConnectionManager from "../controllers/connectionManager";
import { platform } from "os";
import { sqlAuthentication } from "../constants/constants";
import { IConnectionProfile } from "../models/interfaces";
import { FormItemType, FormItemOptions, FormItemSpec } from "../sharedInterfaces/form";
import MainController from "../controllers/mainController";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    validateContainerName,
    checkDockerInstallation,
    startDocker,
    checkEngine,
    startSqlServerDockerContainer,
    checkIfContainerIsReadyForConnections,
    findAvailablePort,
    validateSqlServerPassword,
    validateConnectionName,
} from "./dockerUtils";

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
            if (payload.event.propertyName === "containerName") {
                this.state.isValidContainerName =
                    (await validateContainerName(payload.event.value.toString())) !== "";
            }
            if (payload.event.propertyName === "port") {
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
        this.registerReducer("checkDockerInstallation", async (state, _payload) => {
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
        this.registerReducer("startDocker", async (state, _payload) => {
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
        this.registerReducer("checkEngine", async (state, _payload) => {
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

        this.registerReducer("checkDockerProfile", async (state, _payload) => {
            const errors = await this.validateDockerConnectionProfile(state.formState);
            state.isDockerProfileValid = errors.length === 0;
            return state;
        });
        this.registerReducer("startContainer", async (state, _payload) => {
            if (state.dockerContainerCreationStatus.loadState !== ApiStatus.Loading) return state;
            if (this.state.formState.containerName.trim() === "") {
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
        this.registerReducer("checkContainer", async (state, _payload) => {
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
        this.registerReducer("connectToContainer", async (state, _payload) => {
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
        this.registerReducer("dispose", async (state, _payload) => {
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
        let connection: unknown = {
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
        const connection: unknown = {
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

        return connection as cd.DockerConnectionProfile;
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
                componentWidth: "500px",
                validate(_state, value) {
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
                validate(_state, value) {
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
