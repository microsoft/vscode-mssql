/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../sharedInterfaces/containerDeploymentInterfaces";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import { platform } from "os";
import { defaultPortNumber, localhost, sa, sqlAuthentication } from "../constants/constants";
import { FormItemType, FormItemSpec, FormItemOptions } from "../sharedInterfaces/form";
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
    profileNameTooltip,
} from "../constants/locConstants";
import { IConnectionGroup, IConnectionProfile } from "../models/interfaces";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import {
    createConnectionGroup,
    getDefaultConnectionGroupDialogProps,
} from "../controllers/connectionGroupWebviewController";

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
                title: ContainerDeployment.createLocalSqlContainer,
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
        this.state.platform = platform();
        const versions = await dockerUtils.getSqlServerContainerVersions();
        const groupOptions =
            await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();
        this.state.formComponents = this.setFormComponents(versions, groupOptions);
        this.state.formState = {
            version: versions[0].value,
            password: "",
            savePassword: false,
            profileName: "",
            containerName: "",
            port: undefined,
            hostname: "",
            acceptEula: false,
            groupId: groupOptions[0].value,
        } as cd.DockerConnectionProfile;
        this.state.dockerSteps = dockerUtils.initializeDockerSteps();
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
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
            const currentStepNumber = payload.dockerStep;
            const currentStep = state.dockerSteps[currentStepNumber];
            if (currentStep.loadState !== ApiStatus.NotStarted) return state;

            if (currentStepNumber === cd.DockerStepOrder.dockerInstallation) {
                // If the current step is the first step (docker installation),
                // send telemetry for starting
                sendActionEvent(
                    TelemetryViews.ContainerDeployment,
                    TelemetryActions.StartContainerDeployment,
                );
            }

            // Update the current docker step's status to loading
            this.updateState({
                ...state,
                dockerSteps: {
                    ...state.dockerSteps,
                    [currentStepNumber]: { ...currentStep, loadState: ApiStatus.Loading },
                },
            });

            let dockerResult: cd.DockerCommandParams;
            let stepSuccessful = false;
            if (currentStepNumber === cd.DockerStepOrder.connectToContainer) {
                const connectionResult = await this.addContainerConnection(state.formState);
                stepSuccessful = connectionResult;

                if (!connectionResult) {
                    currentStep.errorMessage = `${connectErrorTooltip} ${state.formState.profileName}`;
                } else {
                    // If the last step is successful, send telemetry for the workflow being finished
                    sendActionEvent(
                        TelemetryViews.ContainerDeployment,
                        TelemetryActions.FinishContainerDeployment,
                        {
                            containerVersion: state.formState.version,
                        },
                    );
                }
            } else {
                const args = currentStep.argNames.map((argName) => state.formState[argName]);
                dockerResult = await currentStep.stepAction(...args);
                stepSuccessful = dockerResult.success;

                if (!stepSuccessful) {
                    currentStep.errorMessage = dockerResult.error;
                    currentStep.fullErrorText = dockerResult.fullErrorText;
                }
            }

            // If the step was successful, update the step's load state to Loaded
            // else, update it to Error and set the error message
            currentStep.loadState = stepSuccessful ? ApiStatus.Loaded : ApiStatus.Error;
            if (stepSuccessful) {
                state.currentDockerStep += 1; // Move to the next step
            } else {
                // If the step failed, log the error and send telemetry
                // Error telemetry includes the step number and error message
                sendErrorEvent(
                    TelemetryViews.ContainerDeployment,
                    TelemetryActions.RunDockerStep,
                    new Error(currentStep.errorMessage),
                    true, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        dockerStep: cd.DockerStepOrder[currentStepNumber],
                    },
                );
            }
            state.dockerSteps[currentStepNumber] = currentStep;

            return state;
        });
        this.registerReducer("resetDockerStepState", async (state, _payload) => {
            // Reset the current step to NotStarted
            const currentStepNumber = state.currentDockerStep;
            state.dockerSteps[currentStepNumber].loadState = ApiStatus.NotStarted;
            sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.RetryDockerStep, {
                dockerStep: cd.DockerStepOrder[currentStepNumber],
            });
            return state;
        });
        this.registerReducer("checkDockerProfile", async (state, _payload) => {
            state.formValidationLoadState = ApiStatus.Loading;
            this.updateState(state);
            state = await this.validateDockerConnectionProfile(state, state.formState);
            if (!state.formState.containerName) {
                state.formState.containerName = await dockerUtils.validateContainerName(
                    state.formState.containerName,
                );
            }

            if (!state.formState.port) {
                state.formState.port = await dockerUtils.findAvailablePort(defaultPortNumber);
            }

            state.isDockerProfileValid = state.formErrors.length === 0;
            state.formValidationLoadState = ApiStatus.NotStarted;
            this.updateState(state);
            return state;
        });

        this.registerReducer("createConnectionGroup", async (state, payload) => {
            const createConnectionGroupResult: IConnectionGroup | string =
                await createConnectionGroup(
                    payload.connectionGroupSpec,
                    this.mainController.connectionManager,
                    TelemetryViews.ConnectionDialog,
                );
            if (typeof createConnectionGroupResult === "string") {
                // If the result is a string, it means there was an error creating the group
                state.formErrors.push(createConnectionGroupResult);
            } else {
                // If the result is an IConnectionGroup, it means the group was created successfully
                state.formState.groupId = createConnectionGroupResult.id;
            }

            state.formComponents.groupId.options =
                await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();

            state.dialog = undefined;

            this.updateState(state);
            return state;
        });

        this.registerReducer("setConnectionGroupDialogState", async (state, payload) => {
            if (payload.shouldOpen) {
                state = getDefaultConnectionGroupDialogProps(
                    state,
                ) as cd.ContainerDeploymentWebviewState;
            } else {
                state.dialog = undefined;
            }
            return state;
        });

        this.registerReducer("dispose", async (state, _payload) => {
            sendActionEvent(
                TelemetryViews.ContainerDeployment,
                TelemetryActions.CloseContainerDeployment,
                {
                    // Include the current step, its status, and its potential error in the telemetry
                    currentStep: cd.DockerStepOrder[state.currentDockerStep],
                    currentStepStatus: state.dockerSteps[state.currentDockerStep]?.loadState,
                    currentStepErrorMessage:
                        state.dockerSteps[state.currentDockerStep]?.errorMessage,
                },
            );
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

    private async addContainerConnection(
        dockerProfile: cd.DockerConnectionProfile,
    ): Promise<boolean> {
        let connection: unknown = {
            ...dockerProfile,
            server: `${localhost},${dockerProfile.port}`,
            profileName: dockerProfile.profileName || dockerProfile.containerName,
            savePassword: dockerProfile.savePassword,
            emptyPasswordInput: false,
            authenticationType: sqlAuthentication,
            user: sa,
            trustServerCertificate: true,
        };

        try {
            const profile = await this.mainController.connectionManager.connectionUI.saveProfile(
                connection as IConnectionProfile,
            );

            await this.mainController.createObjectExplorerSession(profile);
        } catch {
            return false;
        }

        return true;
    }

    private setFormComponents(
        versions: FormItemOptions[],
        groupOptions: FormItemOptions[],
    ): Record<
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
                options: versions,
            }),

            password: createFormItem({
                type: FormItemType.Password,
                propertyName: "password",
                label: passwordPrompt,
                required: true,
                tooltip: ContainerDeployment.sqlServerPasswordTooltip,
                placeholder: ContainerDeployment.passwordPlaceholder,
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
                tooltip: profileNameTooltip,
                placeholder: ContainerDeployment.profileNamePlaceholder,
            }),

            groupId: createFormItem(
                getGroupIdFormItem(groupOptions) as cd.ContainerDeploymentFormItemSpec,
            ),

            containerName: createFormItem({
                type: FormItemType.Input,
                propertyName: "containerName",
                label: ContainerDeployment.containerName,
                isAdvancedOption: true,
                tooltip: ContainerDeployment.containerNameTooltip,
                placeholder: ContainerDeployment.containerNamePlaceholder,
            }),

            port: createFormItem({
                type: FormItemType.Input,
                propertyName: "port",
                label: ContainerDeployment.port,
                isAdvancedOption: true,
                tooltip: ContainerDeployment.portTooltip,
                placeholder: ContainerDeployment.portPlaceholder,
            }),

            hostname: createFormItem({
                type: FormItemType.Input,
                propertyName: "hostname",
                label: ContainerDeployment.hostname,
                isAdvancedOption: true,
                tooltip: ContainerDeployment.hostnameTooltip,
                placeholder: ContainerDeployment.hostnamePlaceholder,
            }),

            acceptEula: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "acceptEula",
                label: `<span>
                        ${Common.accept}
                        <a
                            href="https://go.microsoft.com/fwlink/?LinkId=746388"
                            target="_blank"
                        >
                            ${ContainerDeployment.termsAndConditions}
                        </a>
                    </span>`,
                required: true,
                tooltip: ContainerDeployment.acceptSqlServerEulaTooltip,
                componentWidth: "600px",
                validate(_, value) {
                    return value
                        ? { isValid: true, validationMessage: "" }
                        : {
                              isValid: false,
                              validationMessage: ContainerDeployment.acceptSqlServerEula,
                          };
                },
            }),
        };
    }
}
