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
import { FormItemType, FormItemOptions, FormItemSpec } from "../sharedInterfaces/form";
import MainController from "../controllers/mainController";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as dockerUtils from "./dockerUtils";
import { ContainerDeployment } from "../constants/locConstants";
import { IConnectionProfile } from "../models/interfaces";

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
    ) {
        super(
            context,
            vscodeWrapper,
            "containerDeployment",
            "containerDeployment",
            new cd.ContainerDeploymentWebviewState(),
            {
                title: ContainerDeployment.webviewTitle,
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
        this.state.dockerSteps = dockerUtils.initializeDockerSteps();
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

            return await this.validateDockerConnectionProfile(
                state,
                this.state.formState,
                payload.event.propertyName,
            );
        });
        this.registerReducer("completeDockerStep", async (state, payload) => {
            const currentStepNumber = payload.dockerStepNumber;
            const currentStep = state.dockerSteps[currentStepNumber];
            if (currentStep.loadState !== ApiStatus.Loading) return state;

            let dockerResult: cd.DockerCommandParams;
            if (currentStepNumber === cd.DockerStepOrder.connectToContainer) {
                const connectionResult = await this.addContainerConnection(state.formState);

                state.dockerSteps[currentStepNumber].loadState = connectionResult
                    ? ApiStatus.Loaded
                    : ApiStatus.Error;

                if (!connectionResult) {
                    state.dockerSteps[currentStepNumber].errorMessage =
                        "Failed to connect to container.";
                }
            } else {
                const args = currentStep.argNames.map((argName) => state.formState[argName]);
                dockerResult = await currentStep.stepAction(...args);
                state.dockerSteps = dockerUtils.setStepStatusesFromResult(
                    dockerResult,
                    currentStepNumber,
                    state.dockerSteps,
                );
            }
            return state;
        });

        this.registerReducer("checkDockerProfile", async (state, _payload) => {
            state = await this.validateDockerConnectionProfile(state, state.formState);
            if (!state.formState.containerName) {
                state.formState.containerName = await dockerUtils.validateContainerName(
                    state.formState.containerName,
                );
            }

            if (!state.formState.port) {
                state.formState.port = await dockerUtils.findAvailablePort(1433);
            }

            state.isDockerProfileValid = state.formErrors.length === 0;
            return state;
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

    private async validatePort(port: string): Promise<boolean> {
        // No port chosen
        if (!port) return true;

        const portNumber = Number(port);

        // Check if portNumber is a valid number
        if (isNaN(portNumber) || portNumber <= 0) return false;

        const newPort = await dockerUtils.findAvailablePort(portNumber);
        return newPort === portNumber;
    }

    private async validateDockerConnectionProfile(
        state: cd.ContainerDeploymentWebviewState,
        dockerConnectionProfile: cd.DockerConnectionProfile,
        propertyName?: keyof cd.DockerConnectionProfile,
    ): Promise<cd.ContainerDeploymentWebviewState> {
        const erroredInputs: string[] = [];
        const components = propertyName
            ? [this.state.formComponents[propertyName]]
            : Object.values(this.state.formComponents);

        for (const component of components) {
            if (!component) continue;

            const prop = component.propertyName;

            // Special validation for containerName, because docker commands
            // are called for validation
            if (prop === "containerName") {
                const validationResult = await dockerUtils.validateContainerName(
                    dockerConnectionProfile[prop],
                );
                state.isValidContainerName = validationResult !== "";
                if (!state.isValidContainerName) {
                    erroredInputs.push(prop);
                }
            }
            // Special validation for port, because docker commands
            // are called for validation
            else if (prop === "port") {
                const isValidPort = await this.validatePort(
                    dockerConnectionProfile[prop]?.toString(),
                );
                state.isValidPortNumber = isValidPort;
                if (!isValidPort) {
                    erroredInputs.push(prop);
                }
            }
            // Default validation logic
            else if (component.validate) {
                const result = component.validate(this.state, dockerConnectionProfile[prop]);
                component.validation = result;

                if (!result.isValid) {
                    erroredInputs.push(prop);
                }
            }
        }
        state.formErrors = erroredInputs;
        return state;
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

    private async addContainerConnection(
        dockerProfile: cd.DockerConnectionProfile,
    ): Promise<boolean> {
        let connection: unknown = {
            ...dockerProfile,
            server: `localhost,${dockerProfile.port}`,
            profileName: dockerProfile.profileName || dockerProfile.containerName,
            savePassword: dockerProfile.savePassword,
            emptyPasswordInput: false,
            azureAuthType: undefined,
            accountStore: undefined,
            isValidProfile: () => true,
            isAzureActiveDirectory: () => false,
        };

        return await this.mainController.createObjectExplorerSession(
            connection as IConnectionProfile,
        );
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
                    const testPassword = dockerUtils.validateSqlServerPassword(value.toString());
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
                        value.toString() === "" ||
                        dockerUtils.validateConnectionName(value.toString());
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
