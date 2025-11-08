/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionProfile } from "../models/interfaces";
import { defaultPortNumber, localhost, sa, sqlAuthentication } from "../constants/constants";
import {
    Common,
    connectErrorTooltip,
    ConnectionDialog,
    LocalContainers,
    msgSavePassword,
    passwordPrompt,
} from "../constants/locConstants";
import { DeploymentCommonReducers } from "../sharedInterfaces/deployment";
import * as lc from "../sharedInterfaces/localContainers";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { DEPLOYMENT_VIEW_ID, DeploymentWebviewController } from "./deploymentWebviewController";
import * as dockerUtils from "./dockerUtils";
import MainController from "../controllers/mainController";
import { arch } from "os";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import { UserSurvey } from "../nps/userSurvey";
import { ConnectionCredentials } from "../models/connectionCredentials";

export async function initializeLocalContainersState(
    groupOptions: FormItemOptions[],
    selectedGroupId: string | undefined,
): Promise<lc.LocalContainersState> {
    const startTime = Date.now();
    const state = new lc.LocalContainersState();

    // Issue tracking this: https://github.com/microsoft/vscode-mssql/issues/20337
    if (arch() === "arm64") {
        state.dialog = {
            type: "armSql2025Error",
        };
    }

    const versions = await dockerUtils.getSqlServerContainerVersions();
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
    state.dockerSteps = dockerUtils.initializeDockerSteps();
    state.loadState = ApiStatus.Loaded;
    sendActionEvent(
        TelemetryViews.LocalContainers,
        TelemetryActions.StartLocalContainersDeployment,
        {},
        {
            localContainersInitTimeInMs: Date.now() - startTime,
        },
    );
    return state;
}

export function registerLocalContainersReducers(deploymentController: DeploymentWebviewController) {
    deploymentController.registerReducer("completeDockerStep", async (state, payload) => {
        const localContainersState = state.deploymentTypeState as lc.LocalContainersState;
        const currentStepNumber = payload.dockerStep;
        const currentStep = localContainersState.dockerSteps[currentStepNumber];
        if (currentStep.loadState !== ApiStatus.NotStarted) return state;

        localContainersState.dockerSteps[currentStepNumber].loadState = ApiStatus.Loading;
        // Update the current docker step's status to loading
        updateLocalContainersState(deploymentController, localContainersState);

        let dockerResult: lc.DockerCommandParams;
        let stepSuccessful = false;
        const stepStartTime = Date.now();
        if (currentStepNumber === lc.DockerStepOrder.connectToContainer) {
            const connectionResult = await addContainerConnection(
                localContainersState.formState,
                deploymentController.mainController,
            );
            stepSuccessful = connectionResult;

            if (!connectionResult) {
                currentStep.errorMessage = `${connectErrorTooltip} ${localContainersState.formState.profileName}`;
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

        const telemetryProperties: Record<string, string> = {
            dockerStep: lc.DockerStepOrder[currentStepNumber],
            containerVersion: localContainersState.formState.version,
        };
        const telemetryMeasures: Record<string, number> = {
            timeToCompleteStepInMs: Date.now() - stepStartTime,
        };
        // If the step was successful, update the step's load state to Loaded, send telemetry,
        // and increment the current step number to move to the next step
        if (stepSuccessful) {
            currentStep.loadState = ApiStatus.Loaded;
            sendActionEvent(
                TelemetryViews.LocalContainers,
                TelemetryActions.RunDockerStep,
                telemetryProperties,
                telemetryMeasures,
            );
        } else {
            // If the step failed, update step's load state to Error and set the error message
            // Error telemetry includes the step number and error message
            currentStep.loadState = ApiStatus.Error;
            sendErrorEvent(
                TelemetryViews.LocalContainers,
                TelemetryActions.RunDockerStep,
                new Error(currentStep.errorMessage),
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                telemetryProperties,
                telemetryMeasures,
            );
        }

        localContainersState.dockerSteps[currentStepNumber] = currentStep;
        localContainersState.currentDockerStep += stepSuccessful ? 1 : 0; // Move to the next step if successful

        state.deploymentTypeState = localContainersState;
        return state;
    });
    deploymentController.registerReducer("resetDockerStepState", async (state, _payload) => {
        const localContainersState = state.deploymentTypeState as lc.LocalContainersState;
        // Reset the current step to NotStarted
        const currentStepNumber = localContainersState.currentDockerStep;
        localContainersState.dockerSteps[currentStepNumber].loadState = ApiStatus.NotStarted;
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.RetryDockerStep, {
            dockerStep: lc.DockerStepOrder[currentStepNumber],
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
                hasAdvancedOptions: hasAdvancedOptions ? "true" : "false",
            });
        }
        state.deploymentTypeState = localContainersState;

        if (localContainersState.dialog) {
            state.dialog = localContainersState.dialog;
        }
        return state;
    });
    deploymentController.registerReducer("closeArmSql2025ErrorDialog", async (state, _payload) => {
        state.dialog = undefined;
        state.deploymentTypeState.dialog = undefined;
        return state;
    });
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

    // Issue tracking this: https://github.com/microsoft/vscode-mssql/issues/20337
    if (
        (!propertyName || propertyName === "version") &&
        arch() === "arm64" &&
        state?.formState?.version?.includes("2025")
    ) {
        state.dialog = {
            type: "armSql2025Error",
        };
    }

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
            // Include the current step, its status, and its potential error in the telemetry
            currentStep: lc.DockerStepOrder[state.currentDockerStep],
            currentStepStatus: state.dockerSteps[state.currentDockerStep]?.loadState,
            currentStepErrorMessage: state.dockerSteps[state.currentDockerStep]?.errorMessage,
        },
    );
}

export async function addContainerConnection(
    dockerProfile: lc.DockerConnectionProfile,
    mainController: MainController,
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
        const profile = await mainController.connectionManager.connectionUI.saveProfile(
            connection as IConnectionProfile,
        );

        await mainController.createObjectExplorerSession(profile);
    } catch {
        return false;
    }

    return true;
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
            tooltip:
                arch() === "arm64"
                    ? LocalContainers.sqlServer2025ArmErrorTooltip
                    : LocalContainers.selectImageTooltip,
            options: versions,
            validate(_state, value) {
                // Handle ARM64 architecture case where SQL Server 2025 latest is broken
                // Issue tracking this: https://github.com/microsoft/vscode-mssql/issues/20337
                const isArm64With2025 = arch() === "arm64" && value?.toString()?.includes("2025");
                return {
                    isValid: !isArm64With2025,
                    validationMessage: isArm64With2025 ? LocalContainers.sqlServer2025ArmError : "",
                };
            },
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
    deploymentController.updateState(deploymentController.state);
}

/**
 * Executes a single Docker step programmatically (without UI/reducer layer).
 * This is the core logic extracted from completeDockerStep reducer for reuse.
 *
 * @param dockerProfile - Container configuration profile
 * @param dockerStep - The Docker step to execute
 * @param stepNumber - Index of the step being executed
 * @param mainController - Main controller for connection creation (only needed for connect step)
 * @returns Result indicating success and optional error details
 */
export async function executeDockerStepProgrammatically(
    dockerProfile: lc.DockerConnectionProfile,
    dockerStep: lc.DockerStep,
    stepNumber: lc.DockerStepOrder,
    mainController?: MainController,
): Promise<{ success: boolean; error?: string; fullErrorText?: string; port?: number }> {
    const stepStartTime = Date.now();

    // Special handling for the connection step
    if (stepNumber === lc.DockerStepOrder.connectToContainer) {
        if (!mainController) {
            return {
                success: false,
                error: "Main controller is required for connection step",
            };
        }

        const connectionResult = await addContainerConnection(dockerProfile, mainController);

        if (!connectionResult) {
            return {
                success: false,
                error: `${connectErrorTooltip} ${dockerProfile.profileName}`,
            };
        }

        return { success: true };
    }

    // Execute regular Docker step
    const args = dockerStep.argNames.map((argName) => dockerProfile[argName]);
    const dockerResult = await dockerStep.stepAction(...args);

    const telemetryProperties: Record<string, string> = {
        dockerStep: lc.DockerStepOrder[stepNumber],
        containerVersion: dockerProfile.version,
    };
    const telemetryMeasures: Record<string, number> = {
        timeToCompleteStepInMs: Date.now() - stepStartTime,
    };

    if (dockerResult.success) {
        sendActionEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.RunDockerStep,
            telemetryProperties,
            telemetryMeasures,
        );
    } else {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.RunDockerStep,
            new Error(dockerResult.error),
            true,
            undefined,
            undefined,
            telemetryProperties,
            telemetryMeasures,
        );
    }

    return dockerResult;
}

/**
 * Runs Docker prerequisite checks (first 3 steps: install, start, engine).
 * This validates that Docker is ready before showing form or creating containers.
 *
 * @param onProgress - Optional callback to report progress
 * @returns Object with success flag and optional error details
 */
export async function runDockerPrerequisiteChecks(
    onProgress?: (stepIndex: number, step: lc.DockerStep, allSteps: lc.DockerStep[]) => void,
): Promise<{ success: boolean; error?: string; fullErrorText?: string; steps: lc.DockerStep[] }> {
    const dockerSteps = dockerUtils.initializeDockerSteps();

    // Run only the first 3 prerequisite steps
    const prerequisiteSteps = [
        lc.DockerStepOrder.dockerInstallation,
        lc.DockerStepOrder.startDockerDesktop,
        lc.DockerStepOrder.checkDockerEngine,
    ];

    const dummyProfile = {} as lc.DockerConnectionProfile;

    for (const stepIndex of prerequisiteSteps) {
        const currentStep = dockerSteps[stepIndex];
        currentStep.loadState = ApiStatus.Loading;
        onProgress?.(stepIndex, currentStep, dockerSteps);

        const result = await executeDockerStepProgrammatically(
            dummyProfile,
            currentStep,
            stepIndex,
        );

        if (result.success) {
            currentStep.loadState = ApiStatus.Loaded;
            onProgress?.(stepIndex, currentStep, dockerSteps);
        } else {
            currentStep.loadState = ApiStatus.Error;
            currentStep.errorMessage = result.error;
            currentStep.fullErrorText = result.fullErrorText;
            onProgress?.(stepIndex, currentStep, dockerSteps);

            return {
                success: false,
                error: result.error,
                fullErrorText: result.fullErrorText,
                steps: dockerSteps,
            };
        }
    }

    return {
        success: true,
        steps: dockerSteps,
    };
}

/**
 * Executes all Docker steps sequentially to create a container.
 * This is a programmatic version of the UI-driven flow, suitable for publish scenarios.
 * Assumes prerequisite checks have already passed.
 *
 * @param dockerProfile - Container configuration with all required parameters
 * @param mainController - Main controller for establishing connections
 * @param onProgress - Optional callback to report progress (stepIndex, step, allSteps)
 * @returns Connection information if successful, undefined otherwise
 */
export async function createContainerProgrammatically(
    dockerProfile: lc.DockerConnectionProfile,
    mainController: MainController,
    onProgress?: (stepIndex: number, step: lc.DockerStep, allSteps: lc.DockerStep[]) => void,
): Promise<{ success: boolean; error?: string; fullErrorText?: string; connectionUri?: string }> {
    // Initialize Docker steps
    const dockerSteps = dockerUtils.initializeDockerSteps();

    // Start from step 3 (pullImage) since prerequisites (0-2) are already done
    const containerCreationSteps = [
        lc.DockerStepOrder.pullImage,
        lc.DockerStepOrder.startContainer,
        lc.DockerStepOrder.checkContainer,
    ];

    // Execute container creation steps
    for (const stepIndex of containerCreationSteps) {
        const currentStep = dockerSteps[stepIndex];
        currentStep.loadState = ApiStatus.Loading;
        onProgress?.(stepIndex, currentStep, dockerSteps);

        const result = await executeDockerStepProgrammatically(
            dockerProfile,
            currentStep,
            stepIndex,
            mainController,
        );

        if (result.success) {
            currentStep.loadState = ApiStatus.Loaded;
            onProgress?.(stepIndex, currentStep, dockerSteps);
        } else {
            currentStep.loadState = ApiStatus.Error;
            currentStep.errorMessage = result.error;
            currentStep.fullErrorText = result.fullErrorText;
            onProgress?.(stepIndex, currentStep, dockerSteps);

            return {
                success: false,
                error: result.error,
                fullErrorText: result.fullErrorText,
            };
        }
    }

    // Execute connection step (last step)
    const connectionStepIndex = lc.DockerStepOrder.connectToContainer;
    const connectionStep = dockerSteps[connectionStepIndex];
    connectionStep.loadState = ApiStatus.Loading;
    onProgress?.(connectionStepIndex, connectionStep, dockerSteps);

    const connectionResult = await executeDockerStepProgrammatically(
        dockerProfile,
        connectionStep,
        connectionStepIndex,
        mainController,
    );

    if (connectionResult.success) {
        connectionStep.loadState = ApiStatus.Loaded;
        onProgress?.(connectionStepIndex, connectionStep, dockerSteps);

        // Create a proper connection for DacFx operations
        // Using the connectionManager to establish a registered connection
        const fileUri = `mssql://publish-container-${dockerProfile.containerName}`;
        const connectionDetails = {
            options: {
                server: `${localhost},${dockerProfile.port}`,
                database: "",
                user: sa,
                password: dockerProfile.password,
                authenticationType: sqlAuthentication,
                encrypt: false,
                trustServerCertificate: true,
            },
        };

        try {
            // Use ConnectionCredentials to create proper connection info
            const connectionInfo = ConnectionCredentials.createConnectionInfo(connectionDetails);

            // Connect using ConnectionManager to register the connection
            await mainController.connectionManager.connect(fileUri, connectionInfo, {
                shouldHandleErrors: false,
            });

            return {
                success: true,
                connectionUri: fileUri,
            };
        } catch (error) {
            connectionStep.loadState = ApiStatus.Error;
            connectionStep.errorMessage = `Failed to establish connection: ${error}`;
            onProgress?.(connectionStepIndex, connectionStep, dockerSteps);

            return {
                success: false,
                error: `Failed to establish connection: ${error}`,
            };
        }
    } else {
        connectionStep.loadState = ApiStatus.Error;
        connectionStep.errorMessage = connectionResult.error;
        connectionStep.fullErrorText = connectionResult.fullErrorText;
        onProgress?.(connectionStepIndex, connectionStep, dockerSteps);

        return {
            success: false,
            error: connectionResult.error,
            fullErrorText: connectionResult.fullErrorText,
        };
    }
}
