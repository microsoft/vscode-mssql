/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionProfile } from "../models/interfaces";
import {
    containerConnectionMaxAttempts,
    containerConnectionRetryDelayMs,
    defaultPortNumber,
    localhost,
    sa,
    sqlAuthentication,
} from "../constants/constants";
import {
    Common,
    connectErrorTooltip,
    ConnectionDialog,
    LocalContainers,
    msgSavePassword,
    passwordPrompt,
} from "../constants/locConstants";
import { DeploymentCommonReducers, DeploymentType } from "../sharedInterfaces/deployment";
import * as lc from "../sharedInterfaces/localContainers";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";
import { DEPLOYMENT_VIEW_ID, DeploymentWebviewController } from "./deploymentWebviewController";
import * as dockerUtils from "../docker/dockerUtils";
import * as sqlServerContainer from "./sqlServerContainer";
import MainController from "../controllers/mainController";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import { UserSurvey } from "../nps/userSurvey";
import { BackgroundTaskState } from "../backgroundTasks/backgroundTasksService";
import {
    completeProvisioningTask,
    startProvisioningTask,
    updateProvisioningTask,
} from "./deploymentBackgroundTasks";
import { getErrorMessage } from "../utils/utils";

const activeLocalContainerDeployments = new WeakMap<DeploymentWebviewController, Promise<void>>();

export async function initializeLocalContainersState(
    groupOptions: FormItemOptions[],
    selectedGroupId: string | undefined,
): Promise<lc.LocalContainersState> {
    const startTime = Date.now();
    const state = new lc.LocalContainersState();

    const versions = await sqlServerContainer.getSqlServerContainerVersions();
    state.formComponents = setLocalContainersFormComponents(versions, groupOptions);
    state.formState = {
        version: versions[0].value,
        password: "",
        savePassword: false,
        profileName: "",
        containerName: "",
        port: undefined,
        hostname: "",
        acceptEula: false,
        groupId: selectedGroupId || groupOptions[0]?.value,
    } as lc.DockerConnectionProfile;
    state.dockerSteps = sqlServerContainer.initializeDockerSteps();
    state.loadState = ApiStatus.Loaded;
    sendActionEvent(
        TelemetryViews.LocalContainers,
        TelemetryActions.StartLocalContainersDeployment,
        {
            additionalProps: {},
            additionalMeasurements: {
                localContainersInitTimeInMs: Date.now() - startTime,
            },
        },
    );
    return state;
}

export function registerLocalContainersReducers(deploymentController: DeploymentWebviewController) {
    deploymentController.registerReducer("completeDockerStep", async (state, payload) => {
        const localContainersState = state.deploymentTypeState as lc.LocalContainersState;
        if (payload.dockerStep >= lc.DockerStepOrder.pullImage) {
            let deployment = activeLocalContainerDeployments.get(deploymentController);
            if (!deployment) {
                deployment = runLocalContainerDeployment(deploymentController, localContainersState)
                    .catch((error) => {
                        sendErrorEvent(
                            TelemetryViews.LocalContainers,
                            TelemetryActions.RunDockerStep,
                            {
                                error:
                                    error instanceof Error
                                        ? error
                                        : new Error(getErrorMessage(error)),
                                includeErrorMessage: true,
                            },
                        );
                    })
                    .finally(() => {
                        activeLocalContainerDeployments.delete(deploymentController);
                    });
                activeLocalContainerDeployments.set(deploymentController, deployment);
            }
            void deployment;
        } else {
            await completeLocalContainerStep(
                deploymentController,
                localContainersState,
                payload.dockerStep,
            );
        }

        state.deploymentTypeState = localContainersState;
        return state;
    });
    deploymentController.registerReducer("resetDockerStepState", async (state, _payload) => {
        const localContainersState = state.deploymentTypeState as lc.LocalContainersState;
        // Reset the current step to NotStarted
        const currentStepNumber = localContainersState.currentDockerStep;
        localContainersState.dockerSteps[currentStepNumber].loadState = ApiStatus.NotStarted;
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.RetryDockerStep, {
            additionalProps: {
                dockerStep: lc.DockerStepOrder[currentStepNumber],
            },
        });
        state.deploymentTypeState = localContainersState;
        return state;
    });
    deploymentController.registerReducer("checkDockerProfile", async (state, _payload) => {
        let localContainersState = state.deploymentTypeState as lc.LocalContainersState;
        localContainersState.formValidationLoadState = ApiStatus.Loading;
        updateLocalContainersState(deploymentController, localContainersState);

        localContainersState = await validateDockerConnectionProfile(localContainersState);
        const hasAdvancedOptions =
            localContainersState.formState.containerName ||
            localContainersState.formState.port ||
            localContainersState.formState.hostname;
        if (!localContainersState.formState.containerName) {
            localContainersState.formState.containerName = await dockerUtils.validateContainerName(
                localContainersState.formState.containerName,
            );
        }

        if (!localContainersState.formState.port) {
            localContainersState.formState.port =
                await dockerUtils.findAvailablePort(defaultPortNumber);
        }

        localContainersState.isDockerProfileValid = localContainersState.formErrors.length === 0;
        localContainersState.formValidationLoadState = ApiStatus.NotStarted;

        if (localContainersState.isDockerProfileValid) {
            sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.SubmitContainerForm, {
                additionalProps: {
                    hasAdvancedOptions: hasAdvancedOptions ? "true" : "false",
                },
            });
        }
        state.deploymentTypeState = localContainersState;

        if (localContainersState.dialog) {
            state.dialog = localContainersState.dialog;
        }
        return state;
    });
}

async function runLocalContainerDeployment(
    deploymentController: DeploymentWebviewController,
    state: lc.LocalContainersState,
): Promise<void> {
    while (
        state.currentDockerStep >= lc.DockerStepOrder.pullImage &&
        state.currentDockerStep <= lc.DockerStepOrder.connectToContainer
    ) {
        const stepSuccessful = await completeLocalContainerStep(
            deploymentController,
            state,
            state.currentDockerStep,
        );
        if (!stepSuccessful) {
            return;
        }
    }
}

async function completeLocalContainerStep(
    deploymentController: DeploymentWebviewController,
    localContainersState: lc.LocalContainersState,
    currentStepNumber: number,
): Promise<boolean> {
    const currentStep = localContainersState.dockerSteps[currentStepNumber];
    if (!currentStep || currentStep.loadState !== ApiStatus.NotStarted) {
        return false;
    }

    const containerName = localContainersState.formState.containerName;
    if (currentStepNumber >= lc.DockerStepOrder.pullImage) {
        startProvisioningTask(
            deploymentController,
            DeploymentType.LocalContainers,
            Common.provisioningTarget(containerName),
            containerName,
        );
        updateProvisioningTask(
            deploymentController,
            DeploymentType.LocalContainers,
            currentStep.headerText,
        );
    }

    currentStep.loadState = ApiStatus.Loading;
    updateLocalContainersState(deploymentController, localContainersState);

    let dockerResult: lc.DockerCommandParams;
    let stepSuccessful = false;
    const stepStartTime = Date.now();
    try {
        if (currentStepNumber === lc.DockerStepOrder.connectToContainer) {
            const connectionResult = await addContainerConnection(
                localContainersState.formState,
                deploymentController.mainController,
            );
            stepSuccessful = connectionResult.success;

            if (connectionResult.success) {
                localContainersState.connectionString = connectionResult.connectionString ?? "";
            } else {
                currentStep.errorMessage = `${connectErrorTooltip} ${localContainersState.formState.profileName}`;
                currentStep.fullErrorText = connectionResult.fullErrorText;
            }

            UserSurvey.getInstance().promptUserForNPSFeedback(
                `${DEPLOYMENT_VIEW_ID}_localContainer`,
            );
        } else {
            const args = currentStep.argNames.map(
                (argName) => localContainersState.formState[argName],
            );
            dockerResult = await currentStep.stepAction(...args);
            stepSuccessful = dockerResult.success;

            if (!stepSuccessful) {
                currentStep.errorMessage = dockerResult.error;
                currentStep.fullErrorText = dockerResult.fullErrorText;
            }
        }
    } catch (error) {
        currentStep.loadState = ApiStatus.Error;
        currentStep.errorMessage = getErrorMessage(error);
        localContainersState.dockerSteps[currentStepNumber] = currentStep;
        completeProvisioningTask(
            deploymentController,
            DeploymentType.LocalContainers,
            BackgroundTaskState.Failed,
            LocalContainers.provisioningTaskFailed(containerName, currentStep.errorMessage),
        );
        updateLocalContainersState(deploymentController, localContainersState);
        throw error;
    }

    const telemetryProperties: Record<string, string> = {
        dockerStep: lc.DockerStepOrder[currentStepNumber],
        containerVersion: localContainersState.formState.version,
    };
    const telemetryMeasures: Record<string, number> = {
        timeToCompleteStepInMs: Date.now() - stepStartTime,
    };
    if (stepSuccessful) {
        currentStep.loadState = ApiStatus.Loaded;
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.RunDockerStep, {
            additionalProps: telemetryProperties,
            additionalMeasurements: telemetryMeasures,
        });
    } else {
        currentStep.loadState = ApiStatus.Error;
        sendErrorEvent(TelemetryViews.LocalContainers, TelemetryActions.RunDockerStep, {
            error: new Error(currentStep.errorMessage),
            includeErrorMessage: true,
            additionalProps: telemetryProperties,
            additionalMeasurements: telemetryMeasures,
        });
    }

    localContainersState.dockerSteps[currentStepNumber] = currentStep;
    localContainersState.currentDockerStep += stepSuccessful ? 1 : 0;

    if (!stepSuccessful) {
        completeProvisioningTask(
            deploymentController,
            DeploymentType.LocalContainers,
            BackgroundTaskState.Failed,
            LocalContainers.provisioningTaskFailed(
                containerName,
                currentStep.errorMessage ?? Common.error,
            ),
        );
    } else if (currentStepNumber === lc.DockerStepOrder.connectToContainer) {
        completeProvisioningTask(
            deploymentController,
            DeploymentType.LocalContainers,
            BackgroundTaskState.Succeeded,
            LocalContainers.provisioningTaskSucceeded(containerName),
        );
    }

    updateLocalContainersState(deploymentController, localContainersState);
    return stepSuccessful;
}

export async function handleLocalContainersFormAction(
    state: lc.LocalContainersState,
    payload: DeploymentCommonReducers["formAction"],
): Promise<lc.LocalContainersState> {
    (state.formState as any)[payload.event.propertyName] = payload.event.value;

    return await validateDockerConnectionProfile(state, payload.event.propertyName);
}

export async function validateDockerConnectionProfile(
    state: lc.LocalContainersState,
    propertyName?: keyof lc.DockerConnectionProfile,
): Promise<lc.LocalContainersState> {
    const erroredInputs: string[] = [];
    const components = propertyName
        ? [state.formComponents[propertyName]]
        : Object.values(state.formComponents);

    for (const component of components) {
        if (!component) continue;

        const prop = component.propertyName;

        // Special validation for containerName, because docker commands
        // are called for validation
        if (prop === "containerName") {
            const validationResult = await dockerUtils.validateContainerName(state.formState[prop]);
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
            const isValidPort = await validatePort(state.formState[prop]?.toString());
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
            const result = component.validate(state, state.formState[prop]);
            component.validation = result;

            if (!result.isValid) {
                erroredInputs.push(prop);
            }
        }
    }
    state.formErrors = erroredInputs;

    return state;
}

export async function validatePort(port: string): Promise<boolean> {
    // No port chosen
    if (!port) return true;

    const portNumber = Number(port);

    // Check if portNumber is a valid number
    if (isNaN(portNumber) || portNumber <= 0) return false;

    const newPort = await dockerUtils.findAvailablePort(portNumber);
    return newPort === portNumber;
}

export function sendLocalContainersCloseEventTelemetry(state: lc.LocalContainersState): void {
    sendActionEvent(
        TelemetryViews.LocalContainers,
        TelemetryActions.FinishLocalContainersDeployment,
        {
            additionalProps: {
                // Include the current step, its status, and its potential error in the telemetry
                currentStep: lc.DockerStepOrder[state.currentDockerStep],
                currentStepStatus: state.dockerSteps[state.currentDockerStep]?.loadState,
                currentStepErrorMessage: state.dockerSteps[state.currentDockerStep]?.errorMessage,
            },
        },
    );
}

export async function addContainerConnection(
    dockerProfile: lc.DockerConnectionProfile,
    mainController: MainController,
): Promise<lc.ContainerConnectionResult> {
    const connection = {
        ...dockerProfile,
        server: `${localhost},${dockerProfile.port}`,
        profileName: dockerProfile.profileName || dockerProfile.containerName,
        savePassword: dockerProfile.savePassword,
        emptyPasswordInput: false,
        authenticationType: sqlAuthentication,
        user: sa,
        trustServerCertificate: true,
    } as unknown as IConnectionProfile;

    const connectionManager = mainController.connectionManager;
    const probeUri = `${connection.server}/${dockerProfile.containerName}/deployment`;
    for (let attempt = 0; attempt < containerConnectionMaxAttempts; attempt++) {
        try {
            const connected = await connectionManager.connect(probeUri, connection, {
                shouldHandleErrors: false,
            });
            if (connected) {
                await connectionManager.disconnect(probeUri);
                break;
            }
        } catch {
            // Retry while SQL Server finishes initializing authentication.
        }

        if (attempt + 1 === containerConnectionMaxAttempts) {
            return { success: false };
        }

        if (attempt + 1 < containerConnectionMaxAttempts) {
            await new Promise((resolve) =>
                setTimeout(resolve, containerConnectionRetryDelayMs * Math.pow(2, attempt)),
            );
        }
    }

    try {
        const profile = await connectionManager.connectionUI.saveProfile(connection);
        const connectionString = await connectionManager.getConnectionString(
            connectionManager.createConnectionDetails(profile),
            false /* includePassword */,
            false /* includeApplicationName */,
        );
        await mainController.createObjectExplorerSession(profile);

        return { success: true, connectionString };
    } catch (error) {
        return { success: false, fullErrorText: getErrorMessage(error) };
    }
}

export function setLocalContainersFormComponents(
    versions: FormItemOptions[],
    groupOptions: FormItemOptions[],
): Record<
    string,
    FormItemSpec<
        lc.DockerConnectionProfile,
        lc.LocalContainersState,
        lc.LocalContainersFormItemSpec
    >
> {
    const createFormItem = (
        spec: Partial<lc.LocalContainersFormItemSpec>,
    ): lc.LocalContainersFormItemSpec =>
        ({
            required: false,
            isAdvancedOption: false,
            ...spec,
        }) as lc.LocalContainersFormItemSpec;

    return {
        version: createFormItem({
            type: FormItemType.Dropdown,
            propertyName: "version",
            label: LocalContainers.selectImage,
            required: true,
            tooltip: LocalContainers.selectImageTooltip,
            options: versions,
        }),

        password: createFormItem({
            type: FormItemType.Password,
            propertyName: "password",
            label: passwordPrompt,
            required: true,
            tooltip: LocalContainers.sqlServerPasswordTooltip,
            placeholder: LocalContainers.passwordPlaceholder,
            componentWidth: "500px",
            validate(_state, value) {
                const result = sqlServerContainer.validateSqlServerPassword(value.toString());
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
            tooltip: ConnectionDialog.profileNameTooltip,
            placeholder: ConnectionDialog.profileNamePlaceholder,
        }),

        groupId: createFormItem(getGroupIdFormItem(groupOptions) as lc.LocalContainersFormItemSpec),

        containerName: createFormItem({
            type: FormItemType.Input,
            propertyName: "containerName",
            label: LocalContainers.containerName,
            isAdvancedOption: true,
            tooltip: LocalContainers.containerNameTooltip,
            placeholder: LocalContainers.containerNamePlaceholder,
        }),

        port: createFormItem({
            type: FormItemType.Input,
            propertyName: "port",
            label: LocalContainers.port,
            isAdvancedOption: true,
            tooltip: LocalContainers.portTooltip,
            placeholder: LocalContainers.portPlaceholder,
        }),

        hostname: createFormItem({
            type: FormItemType.Input,
            propertyName: "hostname",
            label: LocalContainers.hostname,
            isAdvancedOption: true,
            tooltip: LocalContainers.hostnameTooltip,
            placeholder: LocalContainers.hostnamePlaceholder,
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
							${LocalContainers.termsAndConditions}
						</a>
					</span>`,
            required: true,
            tooltip: LocalContainers.acceptSqlServerEulaTooltip,
            componentWidth: "600px",
            validate(_, value) {
                return value
                    ? { isValid: true, validationMessage: "" }
                    : {
                          isValid: false,
                          validationMessage: LocalContainers.acceptSqlServerEula,
                      };
            },
        }),
    };
}

export function updateLocalContainersState(
    deploymentController: DeploymentWebviewController,
    newState: lc.LocalContainersState,
) {
    deploymentController.state.deploymentTypeState = newState;
    if (!deploymentController.isDisposed) {
        deploymentController.updateState(deploymentController.state);
    }
}
