/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../sharedInterfaces/containerDeploymentInterfaces";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import { platform } from "os";
import {
    connectionApplicationName,
    defaultContainerPort,
    localhost,
    sqlAuthentication,
} from "../constants/constants";
import { FormItemType, FormItemSpec } from "../sharedInterfaces/form";
import MainController from "../controllers/mainController";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as dockerUtils from "./dockerUtils";
import {
    Common,
    connectErrorTooltip,
    ConnectionDialog,
    ContainerDeployment,
    msgSavePassword,
    passwordPrompt,
    profileNamePlaceholder,
} from "../constants/locConstants";
import { IConnectionProfile } from "../models/interfaces";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";

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

            const newState = await this.validateDockerConnectionProfile(
                state,
                this.state.formState,
                payload.event.propertyName,
            );
            this.updateState(newState);
            return newState;
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
                        `${connectErrorTooltip} ${state.formState.profileName}`;
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
                state.formState.port = await dockerUtils.findAvailablePort(defaultContainerPort);
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
                    component.validation = dockerUtils.invalidContainerNameValidationResult;
                    erroredInputs.push(prop);
                } else {
                    // If the container name is valid, we can reset the validation message
                    component.validation = { isValid: true, validationMessage: "" };
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
                    component.validation = dockerUtils.invalidPortNumberValidationResult;
                    erroredInputs.push(prop);
                } else {
                    component.validation = { isValid: true, validationMessage: "" };
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
            applicationName: connectionApplicationName,
            authenticationType: sqlAuthentication,
            savePassword: false,
            containerName: "",
            version: "2025",
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
            server: `${localhost},${dockerProfile.port}`,
            profileName: dockerProfile.profileName || dockerProfile.containerName,
            savePassword: dockerProfile.savePassword,
            emptyPasswordInput: false,
            azureAuthType: undefined,
            accountStore: undefined,
            isValidProfile: () => true,
            isAzureActiveDirectory: () => false,
        };

        sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.CreateSQLContainer, {
            version: dockerProfile.version,
        });

        this.mainController.connectionManager.connectionUI
            .saveProfile(connection as IConnectionProfile)
            .then(async () => {
                await this.mainController.createObjectExplorerSession(
                    connection as IConnectionProfile,
                );
            })
            .catch(() => {
                return false;
            });

        return true;
    }

    private setFormComponents(): Record<
        string,
        FormItemSpec<
            cd.DockerConnectionProfile,
            cd.ContainerDeploymentWebviewState,
            cd.ContainerDeploymentFormItemSpec
        >
    > {
        const createFormItem = (
            spec: Partial<cd.ContainerDeploymentFormItemSpec>,
        ): cd.ContainerDeploymentFormItemSpec =>
            ({
                required: false,
                isAdvancedOption: false,
                ...spec,
            }) as cd.ContainerDeploymentFormItemSpec;

        return {
            version: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "version",
                label: ContainerDeployment.selectImage,
                required: true,
                tooltip: ContainerDeployment.selectImageTooltip,
                options: dockerUtils.sqlVersions,
            }),

            password: createFormItem({
                type: FormItemType.Password,
                propertyName: "password",
                label: passwordPrompt,
                required: true,
                tooltip: ContainerDeployment.sqlServerPasswordTooltip,
                componentWidth: "500px",
                validate(_state, value) {
                    const result = dockerUtils.validateSqlServerPassword(value.toString());
                    return {
                        isValid: result === "",
                        validationMessage: result,
                    };
                },
            }),

            savePassword: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "savePassword",
                label: ConnectionDialog.savePassword,
                tooltip: msgSavePassword,
                componentWidth: "375px",
            }),

            profileName: createFormItem({
                type: FormItemType.Input,
                propertyName: "profileName",
                label: ConnectionDialog.profileName,
                tooltip: profileNamePlaceholder,
                validate(_state, value) {
                    const isValid =
                        value.toString() === "" ||
                        dockerUtils.validateConnectionName(value.toString());
                    return {
                        isValid,
                        validationMessage: isValid
                            ? ""
                            : ContainerDeployment.pleaseChooseUniqueProfileName,
                    };
                },
            }),

            containerName: createFormItem({
                type: FormItemType.Input,
                propertyName: "containerName",
                label: ContainerDeployment.containerName,
                isAdvancedOption: true,
                tooltip: ContainerDeployment.containerNameTooltip,
                validate(state, _) {
                    return { isValid: state.isValidContainerName, validationMessage: "" };
                },
            }),

            port: createFormItem({
                type: FormItemType.Input,
                propertyName: "port",
                label: ContainerDeployment.port,
                isAdvancedOption: true,
                tooltip: ContainerDeployment.portTooltip,
                validate(state, _) {
                    return { isValid: state.isValidPortNumber, validationMessage: "" };
                },
            }),

            hostname: createFormItem({
                type: FormItemType.Input,
                propertyName: "hostname",
                label: ContainerDeployment.hostname,
                isAdvancedOption: true,
                tooltip: ContainerDeployment.hostnameTooltip,
            }),

            acceptEula: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "acceptEula",
                label: `<span>
                        ${Common.accept}
                        <a
                            href="https://www.docker.com/legal/docker-subscription-service-agreement/"
                            target="_blank"
                        >
                            ${ContainerDeployment.termsAndConditions}
                        </a>
                    </span>`,
                required: true,
                tooltip: ContainerDeployment.acceptDockerEulaTooltip,
                componentWidth: "600px",
                validate(_, value) {
                    return value
                        ? { isValid: true, validationMessage: "" }
                        : {
                              isValid: false,
                              validationMessage: ContainerDeployment.acceptDockerEula,
                          };
                },
            }),
        };
    }
}
