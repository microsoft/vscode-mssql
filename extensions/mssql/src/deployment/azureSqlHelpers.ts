/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureSqlDatabaseRequests,
    ContainerEngine,
    ContainerEnginePrerequisite,
    ContainerEnginePrerequisiteResult,
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
    AzureSqlContainerProvisioningResult,
    AzureSqlContainerProvisioningStep,
    azureSqlContainerProvisioningSteps as containerProvisioningSteps,
    isAzureSqlContainerEntraAuthentication,
} from "../sharedInterfaces/azureSqlDatabase";
import { getErrorMessage } from "../utils/utils";
import { DeploymentWebviewController } from "./deploymentWebviewController";
import { validateSqlServerPassword } from "./sqlServerContainer";
import { Accounts, AzureSqlContainer, ConnectionDialog } from "../constants/locConstants";
import * as dockerUtils from "../docker/dockerUtils";
import { defaultPortNumber, localhost, sa, sqlAuthentication } from "../constants/constants";
import { ConnectionProfile } from "../models/connectionProfile";
import MainController from "../controllers/mainController";
import { Deferred } from "../protocol";
import {
    completeProvisioningTask,
    startProvisioningTask,
    updateProvisioningTask,
} from "./deploymentBackgroundTasks";
import { DeploymentType } from "../sharedInterfaces/deployment";
import { BackgroundTaskState } from "../backgroundTasks/backgroundTasksService";
import {
    isValidPortNumber,
    validatePort,
    waitForContainerConnection,
    waitForContainerDelay,
} from "./localContainersHelpers";
import {
    executeContainerEngineCommand,
    getContainerEngineExecutable,
} from "../docker/containerEngine";
import { AuthenticationType } from "../sharedInterfaces/connectionDialog";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
} from "../azure/vscodeEntraMfaUtils";
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import fixPath from "fix-path";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { logger } from "../models/logger";
export { executeContainerEngineCommand } from "../docker/containerEngine";

export const defaultAzureSqlContainerName = "azure_sql_db_container";
export const azureSqlContainerImage =
    "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest";
// "sqlbuilds.azurecr.io/mssql-p-sqldbdev-daily/azure-sql/db-dev:latest";
const containerReadyTimeoutMs = 300_000;
const containerReadyPollIntervalMs = 2_000;
const containerEntraCertificatePath = "/var/opt/mssql/mssql-entra-id.pfx";
const guidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const firstConnectionKey = "azureSqlContainer.hasConnected";
const connectedStores = new WeakSet<vscode.Memento>();

interface ContainerEntraAdministrator {
    id: string;
    name: string;
}

interface AzureSqlContainerDeployment {
    abortController: AbortController;
    promise: Promise<void>;
    stepResults: Map<AzureSqlContainerProvisioningStep, AzureSqlContainerProvisioningResult>;
    stepCompletions: Map<
        AzureSqlContainerProvisioningStep,
        Deferred<AzureSqlContainerProvisioningResult>
    >;
}

const azureSqlContainerDeployments = new WeakMap<
    DeploymentWebviewController,
    AzureSqlContainerDeployment
>();

interface PrerequisiteCommand {
    executable: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
}

const prerequisiteCommands: Record<
    ContainerEngine,
    Partial<Record<ContainerEnginePrerequisite, PrerequisiteCommand>>
> = {
    [ContainerEngine.Docker]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "docker",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "docker",
            args: ["info"],
        },
        [ContainerEnginePrerequisite.Configuration]: {
            executable: "docker",
            args: ["info", "--format", "{{.OSType}}"],
        },
    },
    [ContainerEngine.Podman]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "podman",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "podman",
            args: ["info"],
        },
    },
    [ContainerEngine.Containerd]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "nerdctl",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "nerdctl",
            args: ["info"],
        },
    },
    [ContainerEngine.AppleContainer]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "container",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "container",
            args: ["system", "status"],
        },
    },
    [ContainerEngine.WslContainer]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "wslc",
            args: ["version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "wslc",
            args: ["container", "list"],
        },
    },
};

export function registerAzureSqlRpcHandlers(
    deploymentController: DeploymentWebviewController,
): void {
    const validateForm = (form: AzureSqlContainerForm) => {
        const errors = validateAzureSqlContainerForm(form);
        if (
            !deploymentController.state.connectionGroupOptions.some(
                (group) => group.value === form.groupId,
            )
        ) {
            errors.groupId = AzureSqlContainer.selectConnectionGroup;
        }
        return errors;
    };
    deploymentController.onRequest(AzureSqlDatabaseRequests.ValidateContainerForm, validateForm);
    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ContainerEntraAccounts,
        async ({ signIn }) => {
            if (signIn) {
                await VsCodeAzureHelper.signIn(true);
            }
            const accounts = await VsCodeAzureHelper.getAccounts();
            return accounts.map((account) => ({
                value: account.id,
                displayName: account.label,
            }));
        },
    );
    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ContainerEntraTenants,
        async ({ accountId }) => {
            const tenants = await VsCodeAzureHelper.getTenantsForAccount(accountId);
            return tenants.map((tenant) => ({
                value: tenant.tenantId,
                displayName: tenant.displayName,
            }));
        },
    );
    deploymentController.onRequest(AzureSqlDatabaseRequests.PrepareContainerForm, async (form) => {
        const result = await prepareAzureSqlContainerForm(form);
        return {
            form: result.form,
            errors: { ...validateForm(result.form), ...result.errors },
        };
    });

    deploymentController.onRequest(AzureSqlDatabaseRequests.SelectContainerPfxFile, async () => {
        const selection = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: AzureSqlContainer.selectPfxFile,
            filters: { [AzureSqlContainer.pfxFiles]: ["pfx"] },
        });
        return selection?.[0]?.fsPath;
    });

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ValidateContainerPort,
        async ({ port }) => {
            if (port && !isValidPortNumber(port)) {
                return AzureSqlContainer.invalidPort;
            }
            return (await validatePort(port)) ? undefined : AzureSqlContainer.portInUse;
        },
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.GenerateContainerPort,
        async ({ startPort = defaultPortNumber }) => {
            const port = await dockerUtils.findAvailablePort(startPort);
            if (port <= 0) {
                throw new Error(AzureSqlContainer.portDetectionFailed);
            }
            return port;
        },
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.GenerateContainerName, async () =>
        generateAzureSqlContainerName(),
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.DetectContainerEngines, async () => {
        const startedAt = performance.now();
        const workflowCorrelationId = deploymentController.workflowCorrelationId;
        const properties = {
            hostArchitecture: os.arch(),
            hostOS: os.platform(),
            initiatedBy: "VSCode",
            ...(workflowCorrelationId ? { workflowCorrelationId } : {}),
        };
        try {
            const results = await detectContainerEngines();
            sendActionEvent(TelemetryViews.AzureContainer, "DetectContainerEngines", {
                additionalProps: {
                    ...properties,
                    status: "succeeded",
                    ...Object.fromEntries(
                        Object.entries(results).map(([engine, result]) => [
                            `${engine}Detected`,
                            String(result.success),
                        ]),
                    ),
                },
                additionalMeasurements: { durationInMs: performance.now() - startedAt },
            });
            return results;
        } catch (error) {
            sendErrorEvent(TelemetryViews.AzureContainer, "DetectContainerEngines", {
                additionalProps: { ...properties, status: "failed" },
                additionalMeasurements: { durationInMs: performance.now() - startedAt },
                errorType: "AzureSqlContainerOperationFailed",
                includeErrorMessage: false,
            });
            throw error;
        }
    });

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.CheckContainerEnginePrerequisite,
        async (payload) => {
            const startedAt = performance.now();
            const result = await checkContainerEnginePrerequisite(
                payload.engine,
                payload.prerequisite,
            );
            const workflowCorrelationId = deploymentController.workflowCorrelationId;
            const telemetry = {
                additionalProps: {
                    containerEngine:
                        Object.values(ContainerEngine).find((value) => value === payload.engine) ??
                        "unknown",
                    hostArchitecture: os.arch(),
                    hostOS: os.platform(),
                    initiatedBy: "VSCode",
                    ...(workflowCorrelationId ? { workflowCorrelationId } : {}),
                    prerequisite:
                        Object.values(ContainerEnginePrerequisite).find(
                            (value) => value === payload.prerequisite,
                        ) ?? "unknown",
                    status: result.success ? "succeeded" : "failed",
                },
                additionalMeasurements: { durationInMs: performance.now() - startedAt },
            };
            if (result.success) {
                sendActionEvent(
                    TelemetryViews.AzureContainer,
                    "CheckContainerEnginePrerequisite",
                    telemetry,
                );
            } else {
                sendErrorEvent(TelemetryViews.AzureContainer, "CheckContainerEnginePrerequisite", {
                    ...telemetry,
                    errorType: "AzureSqlContainerOperationFailed",
                    includeErrorMessage: false,
                });
            }
            return result;
        },
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.RunContainerProvisioningStep,
        async (payload) => {
            if (!containerProvisioningSteps.includes(payload.step)) {
                return { success: false, error: AzureSqlContainer.invalidProvisioningStep };
            }
            let deployment = azureSqlContainerDeployments.get(deploymentController);
            if (payload.retry && deployment) {
                await deployment.promise;
                deployment = startAzureSqlContainerDeployment(
                    deploymentController,
                    payload.engine,
                    payload.form,
                    payload.step,
                    deployment.stepResults,
                );
            } else if (!deployment) {
                deployment = startAzureSqlContainerDeployment(
                    deploymentController,
                    payload.engine,
                    payload.form,
                    payload.step,
                );
            }
            return deployment.stepCompletions.get(payload.step)!.promise;
        },
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.CancelContainerProvisioning, async () =>
        cancelAzureSqlContainerProvisioning(deploymentController),
    );
}

export async function prepareAzureSqlContainerForm(
    form: AzureSqlContainerForm,
): Promise<{ form: AzureSqlContainerForm; errors: AzureSqlContainerFormErrors }> {
    const preparedForm = { ...form };
    let portError: string | undefined;
    if (!preparedForm.port) {
        const port = await dockerUtils.findAvailablePort(defaultPortNumber);
        if (port > 0) {
            preparedForm.port = String(port);
        } else {
            portError = AzureSqlContainer.portDetectionFailed;
        }
    }
    const errors = validateAzureSqlContainerForm(preparedForm);
    if (portError) {
        errors.port = portError;
    } else if (form.port && !errors.port && !(await validatePort(preparedForm.port))) {
        errors.port = AzureSqlContainer.portInUse;
    }
    return { form: preparedForm, errors };
}

export async function cancelAzureSqlContainerProvisioning(
    deploymentController: DeploymentWebviewController,
): Promise<void> {
    const deployment = azureSqlContainerDeployments.get(deploymentController);
    if (!deployment) {
        return;
    }

    deployment.abortController.abort();
    await deployment.promise;
}

function getProvisioningStepMessage(step: AzureSqlContainerProvisioningStep): string {
    switch (step) {
        case AzureSqlContainerProvisioningStep.PullImage:
            return AzureSqlContainer.pullingContainerImage;
        case AzureSqlContainerProvisioningStep.CreateContainer:
            return AzureSqlContainer.creatingContainer;
        case AzureSqlContainerProvisioningStep.WaitForReady:
            return AzureSqlContainer.settingUpContainer;
        case AzureSqlContainerProvisioningStep.Connect:
            return AzureSqlContainer.connectingToContainer;
    }
}

function startAzureSqlContainerDeployment(
    deploymentController: DeploymentWebviewController,
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    startStep: AzureSqlContainerProvisioningStep,
    previousResults?: Map<AzureSqlContainerProvisioningStep, AzureSqlContainerProvisioningResult>,
): AzureSqlContainerDeployment {
    const abortController = new AbortController();
    const stepResults = new Map(previousResults);
    const stepCompletions = new Map<
        AzureSqlContainerProvisioningStep,
        Deferred<AzureSqlContainerProvisioningResult>
    >();
    const startIndex = containerProvisioningSteps.indexOf(startStep);

    for (const [index, step] of containerProvisioningSteps.entries()) {
        const completion = new Deferred<AzureSqlContainerProvisioningResult>();
        stepCompletions.set(step, completion);
        if (index < startIndex) {
            completion.resolve(stepResults.get(step) ?? { success: true });
        }
    }

    const deployment = {
        abortController,
        stepResults,
        stepCompletions,
        promise: Promise.resolve(),
    };
    azureSqlContainerDeployments.set(deploymentController, deployment);
    deployment.promise = runAzureSqlContainerDeployment(
        deploymentController,
        engine,
        form,
        startStep,
        abortController.signal,
        (step, result) => {
            stepResults.set(step, result);
            stepCompletions.get(step)?.resolve(result);
        },
        undefined,
        previousResults !== undefined,
    );
    return deployment;
}

export async function runAzureSqlContainerDeployment(
    deploymentController: DeploymentWebviewController,
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    startStep: AzureSqlContainerProvisioningStep,
    signal: AbortSignal,
    onStepComplete: (
        step: AzureSqlContainerProvisioningStep,
        result: AzureSqlContainerProvisioningResult,
    ) => void,
    executeStep = runAzureSqlContainerProvisioningStep,
    isRetry = false,
): Promise<void> {
    const startIndex = containerProvisioningSteps.indexOf(startStep);
    const startedAt = performance.now();
    const workflowCorrelationId = deploymentController.workflowCorrelationId;
    const properties = {
        containerEngine:
            Object.values(ContainerEngine).find((value) => value === engine) ?? "unknown",
        hostArchitecture: os.arch(),
        hostOS: os.platform(),
        initiatedBy: "VSCode",
        ...(workflowCorrelationId ? { workflowCorrelationId } : {}),
        startStep,
        isRetry: String(isRetry),
    };
    let currentStep = startStep;
    let startupStartedAt =
        startStep === AzureSqlContainerProvisioningStep.WaitForReady ? startedAt : undefined;
    let outcome = BackgroundTaskState.Failed;
    let failureMessage = AzureSqlContainer.createContainerFailed;
    sendActionEvent(TelemetryViews.AzureContainer, "StartAzureSqlContainerDeployment", {
        additionalProps: properties,
    });
    try {
        if (startIndex < 0) {
            throw new Error(AzureSqlContainer.invalidProvisioningStep);
        }
        startProvisioningTask(
            deploymentController,
            DeploymentType.AzureSqlContainer,
            AzureSqlContainer.provisioningTask,
            form.containerName,
        );

        for (const step of containerProvisioningSteps.slice(startIndex)) {
            currentStep = step;
            const stepStartedAt = performance.now();
            if (step === AzureSqlContainerProvisioningStep.CreateContainer) {
                startupStartedAt = stepStartedAt;
            }
            let result: AzureSqlContainerProvisioningResult | undefined;
            try {
                updateProvisioningTask(
                    deploymentController,
                    DeploymentType.AzureSqlContainer,
                    getProvisioningStepMessage(step),
                );
                const stepResult = await executeStep(
                    engine,
                    step,
                    form,
                    deploymentController.mainController,
                    signal,
                );
                result = signal.aborted ? { success: false } : stepResult;
            } finally {
                const status = result?.success
                    ? "succeeded"
                    : signal.aborted
                      ? "cancelled"
                      : "failed";
                const stepTelemetry = {
                    additionalProps: { ...properties, step, status },
                    additionalMeasurements: { durationInMs: performance.now() - stepStartedAt },
                };
                if (status === "failed") {
                    sendErrorEvent(
                        TelemetryViews.AzureContainer,
                        "AzureSqlContainerProvisioningStep",
                        {
                            ...stepTelemetry,
                            errorType: "AzureSqlContainerOperationFailed",
                            includeErrorMessage: false,
                        },
                    );
                } else {
                    sendActionEvent(
                        TelemetryViews.AzureContainer,
                        "AzureSqlContainerProvisioningStep",
                        stepTelemetry,
                    );
                }
                if (
                    step === AzureSqlContainerProvisioningStep.PullImage ||
                    step === AzureSqlContainerProvisioningStep.Connect
                ) {
                    const action =
                        step === AzureSqlContainerProvisioningStep.PullImage
                            ? TelemetryActions.PullImage
                            : TelemetryActions.ConnectToContainer;
                    const telemetry =
                        step === AzureSqlContainerProvisioningStep.PullImage
                            ? {
                                  ...stepTelemetry,
                                  additionalProps: {
                                      ...stepTelemetry.additionalProps,
                                      registry: azureSqlContainerImage.startsWith(
                                          "mcr.microsoft.com/",
                                      )
                                          ? "MCR"
                                          : azureSqlContainerImage.includes(".azurecr.io/")
                                            ? "ACR"
                                            : "other",
                                      pullType: "requested",
                                  },
                              }
                            : stepTelemetry;
                    if (status === "failed") {
                        sendErrorEvent(TelemetryViews.AzureContainer, action, {
                            ...telemetry,
                            errorType: "AzureSqlContainerOperationFailed",
                            includeErrorMessage: false,
                        });
                    } else {
                        sendActionEvent(TelemetryViews.AzureContainer, action, telemetry);
                    }
                }
                if (
                    startupStartedAt !== undefined &&
                    (step === AzureSqlContainerProvisioningStep.WaitForReady || !result?.success)
                ) {
                    const startupTelemetry = {
                        ...stepTelemetry,
                        additionalMeasurements: {
                            durationInMs: performance.now() - startupStartedAt,
                        },
                    };
                    if (status === "failed") {
                        sendErrorEvent(TelemetryViews.AzureContainer, "StartContainer", {
                            ...startupTelemetry,
                            errorType: "AzureSqlContainerOperationFailed",
                            includeErrorMessage: false,
                        });
                    } else {
                        sendActionEvent(
                            TelemetryViews.AzureContainer,
                            "StartContainer",
                            startupTelemetry,
                        );
                    }
                    startupStartedAt = undefined;
                }
            }
            onStepComplete(step, result);

            if (!result.success) {
                outcome = signal.aborted
                    ? BackgroundTaskState.Canceled
                    : BackgroundTaskState.Failed;
                failureMessage = result.error ?? AzureSqlContainer.createContainerFailed;
                return;
            }
        }
        outcome = signal.aborted ? BackgroundTaskState.Canceled : BackgroundTaskState.Succeeded;
    } catch (error) {
        const errorMessage = sanitizeProvisioningError(error, form);
        onStepComplete(currentStep, {
            success: false,
            error: errorMessage,
            fullErrorText: errorMessage,
        });
        outcome = signal.aborted ? BackgroundTaskState.Canceled : BackgroundTaskState.Failed;
        failureMessage = errorMessage;
    } finally {
        completeProvisioningTask(
            deploymentController,
            DeploymentType.AzureSqlContainer,
            outcome,
            outcome === BackgroundTaskState.Succeeded
                ? AzureSqlContainer.provisioningTaskSucceeded(form.containerName)
                : outcome === BackgroundTaskState.Canceled
                  ? AzureSqlContainer.provisioningTaskCanceled(form.containerName)
                  : AzureSqlContainer.provisioningTaskFailed(form.containerName, failureMessage),
        );
        const telemetry = {
            additionalProps: {
                ...properties,
                status:
                    outcome === BackgroundTaskState.Succeeded
                        ? "succeeded"
                        : outcome === BackgroundTaskState.Canceled
                          ? "cancelled"
                          : "failed",
            },
            additionalMeasurements: { durationInMs: performance.now() - startedAt },
        };
        if (outcome === BackgroundTaskState.Failed) {
            sendErrorEvent(TelemetryViews.AzureContainer, "FinishAzureSqlContainerDeployment", {
                ...telemetry,
                errorType: "AzureSqlContainerOperationFailed",
                includeErrorMessage: false,
            });
        } else {
            sendActionEvent(
                TelemetryViews.AzureContainer,
                "FinishAzureSqlContainerDeployment",
                telemetry,
            );
        }
    }
}

export async function generateAzureSqlContainerName(): Promise<string> {
    return dockerUtils.validateContainerName("", defaultAzureSqlContainerName);
}

export function validateAzureSqlContainerForm(
    form: AzureSqlContainerForm,
): AzureSqlContainerFormErrors {
    const errors: AzureSqlContainerFormErrors = {};
    if (isAzureSqlContainerEntraAuthentication(form.authenticationType)) {
        if (!form.accountId) {
            errors.accountId = AzureSqlContainer.selectEntraAccount;
        }
        if (!form.tenantId) {
            errors.tenantId = ConnectionDialog.tenantIdIsRequired;
        }
        if (!guidPattern.test(form.applicationId ?? "")) {
            errors.applicationId = AzureSqlContainer.invalidApplicationClientId;
        }
        if (
            !form.pfxFilePath ||
            !path.isAbsolute(form.pfxFilePath) ||
            path.extname(form.pfxFilePath).toLowerCase() !== ".pfx"
        ) {
            errors.pfxFilePath = AzureSqlContainer.pfxFileRequired;
        }
        if (
            form.authenticationType === AuthenticationType.ActiveDirectoryServicePrincipal &&
            !form.servicePrincipalClientSecret?.trim()
        ) {
            errors.servicePrincipalClientSecret =
                AzureSqlContainer.servicePrincipalClientSecretRequired;
        }
    } else if (
        form.authenticationType !== undefined &&
        form.authenticationType !== AuthenticationType.SqlLogin
    ) {
        errors.authenticationType = AzureSqlContainer.invalidAuthenticationType;
    }
    const passwordError = validateSqlServerPassword(form.password);
    if (passwordError) {
        errors.password = passwordError;
    }
    if (!isValidPortNumber(form.port)) {
        errors.port = AzureSqlContainer.invalidPort;
    }
    if (form.containerName && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(form.containerName)) {
        errors.containerName = AzureSqlContainer.invalidContainerName;
    }
    if (
        form.hostname &&
        (form.hostname.length > 253 ||
            !form.hostname
                .split(".")
                .every(
                    (label) =>
                        label.length <= 63 &&
                        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
                ))
    ) {
        errors.hostname = AzureSqlContainer.invalidHostname;
    }
    if (!form.acceptEula) {
        errors.acceptEula = AzureSqlContainer.acceptTerms;
    }
    return errors;
}

export async function detectContainerEngines(): Promise<
    Record<ContainerEngine, ContainerEnginePrerequisiteResult>
>;
export async function detectContainerEngines(
    checkPrerequisite: typeof checkContainerEnginePrerequisite,
): Promise<Record<ContainerEngine, ContainerEnginePrerequisiteResult>>;
export async function detectContainerEngines(
    checkPrerequisite = checkContainerEnginePrerequisite,
): Promise<Record<ContainerEngine, ContainerEnginePrerequisiteResult>> {
    fixPath();
    const detectionResults = await Promise.all(
        Object.values(ContainerEngine).map(async (engine) => {
            const result = await checkPrerequisite(
                engine,
                ContainerEnginePrerequisite.Installation,
            );
            return [engine, result] as const;
        }),
    );

    return Object.fromEntries(detectionResults) as Record<
        ContainerEngine,
        ContainerEnginePrerequisiteResult
    >;
}

export async function checkContainerEnginePrerequisite(
    engine: ContainerEngine,
    prerequisite: ContainerEnginePrerequisite,
): Promise<ContainerEnginePrerequisiteResult> {
    const command = prerequisiteCommands[engine]?.[prerequisite];
    if (!command) {
        return { success: true };
    }

    try {
        const result = await executeContainerEngineCommand(command, 15_000);

        if (
            engine === ContainerEngine.Docker &&
            prerequisite === ContainerEnginePrerequisite.Configuration &&
            result.stdout.trim().toLowerCase() !== "linux"
        ) {
            return {
                success: false,
                error: `Docker is configured to use ${result.stdout.trim()} containers instead of Linux containers.`,
            };
        }

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}

function getPullArguments(engine: ContainerEngine): string[] {
    return engine === ContainerEngine.AppleContainer
        ? ["image", "pull", azureSqlContainerImage]
        : ["pull", azureSqlContainerImage];
}

function getRunArguments(
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    administrator?: ContainerEntraAdministrator,
): string[] {
    const args = engine === ContainerEngine.AppleContainer ? ["run", "--detach"] : ["run", "-d"];
    args.push(
        "--name",
        form.containerName,
        "-e",
        "ACCEPT_EULA=Y",
        "-e",
        "MSSQL_SA_PASSWORD",
        "-p",
        `${form.port}:1433`,
    );
    if (form.hostname) {
        args.push("--hostname", form.hostname);
    }
    if (isAzureSqlContainerEntraAuthentication(form.authenticationType)) {
        if (
            !administrator ||
            !guidPattern.test(administrator.id) ||
            !administrator.name.trim() ||
            !form.applicationId ||
            !form.tenantId ||
            !form.pfxFilePath
        ) {
            throw new Error(AzureSqlContainer.invalidEntraAdministrator);
        }
        for (const setting of [
            `MSSQL_AAD_CLIENT_ID=${form.applicationId}`,
            `MSSQL_AAD_PRIMARY_TENANT=${form.tenantId}`,
            `MSSQL_AAD_CERTIFICATE_FILE_PATH=${containerEntraCertificatePath}`,
            `MSSQL_AAD_SERVER_ADMIN_NAME=${administrator.name}`,
            "MSSQL_AAD_SERVER_ADMIN_TYPE=0",
            `MSSQL_AAD_SERVER_ADMIN_SID=${administrator.id}`,
        ]) {
            args.push("-e", setting);
        }
        args.push("-v", `${form.pfxFilePath}:${containerEntraCertificatePath}:ro`);
    }
    args.push(azureSqlContainerImage);
    return args;
}

export function getAzureSqlContainerProvisioningCommand(
    engine: ContainerEngine,
    step:
        | AzureSqlContainerProvisioningStep.PullImage
        | AzureSqlContainerProvisioningStep.CreateContainer
        | AzureSqlContainerProvisioningStep.WaitForReady,
    form: AzureSqlContainerForm,
    administrator?: ContainerEntraAdministrator,
): PrerequisiteCommand {
    if (step === AzureSqlContainerProvisioningStep.WaitForReady) {
        return {
            executable: getContainerEngineExecutable(engine),
            args: [
                "exec",
                "--env",
                "SQLCMDPASSWORD",
                form.containerName,
                "/opt/mssql-tools18/bin/sqlcmd",
                "-S",
                localhost,
                "-U",
                sa,
                "-C",
                "-b",
                "-l",
                "5",
                "-t",
                "5",
                "-Q",
                "SELECT 1",
            ],
            env: { SQLCMDPASSWORD: form.password },
        };
    }
    return {
        executable: getContainerEngineExecutable(engine),
        args:
            step === AzureSqlContainerProvisioningStep.PullImage
                ? getPullArguments(engine)
                : getRunArguments(engine, form, administrator),
        ...(step === AzureSqlContainerProvisioningStep.CreateContainer
            ? {
                  env: {
                      MSSQL_SA_PASSWORD: form.password,
                  },
              }
            : {}),
    };
}

export async function waitForAzureSqlContainer(
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    signal?: AbortSignal,
    executeCommand = executeContainerEngineCommand,
): Promise<AzureSqlContainerProvisioningResult> {
    const command = getAzureSqlContainerProvisioningCommand(
        engine,
        AzureSqlContainerProvisioningStep.WaitForReady,
        form,
    );
    const deadline = Date.now() + containerReadyTimeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline && !signal?.aborted) {
        try {
            await executeCommand(
                command,
                Math.max(1, Math.min(15_000, deadline - Date.now())),
                signal,
            );
            if (!signal?.aborted && Date.now() < deadline) {
                return { success: true };
            }
        } catch (error) {
            lastError = error;
        }
        await waitForContainerDelay(
            Math.min(containerReadyPollIntervalMs, Math.max(0, deadline - Date.now())),
            signal,
        );
    }

    return {
        success: false,
        error: AzureSqlContainer.containerNotReady,
        ...(lastError === undefined
            ? {}
            : { fullErrorText: sanitizeProvisioningError(lastError, form) }),
    };
}

function sanitizeProvisioningError(error: unknown, form: AzureSqlContainerForm): string {
    let errorText = typeof error === "string" ? error : getErrorMessage(error);
    const secrets = [form.password, form.servicePrincipalClientSecret].sort(
        (a, b) => (b?.length ?? 0) - (a?.length ?? 0),
    );
    for (const secret of secrets) {
        if (secret) {
            errorText = errorText.replaceAll(secret, "******");
        }
    }
    return dockerUtils.sanitizeErrorText(errorText);
}

async function addAzureSqlContainerConnection(
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    mainController: MainController,
    signal?: AbortSignal,
): Promise<AzureSqlContainerProvisioningResult> {
    const connection = new ConnectionProfile();
    Object.assign(connection, {
        server: `${localhost},${form.port}`,
        profileName: form.profileName || form.containerName,
        // Mark the profile as a container now, rather than when a later connection matches the
        // machine name: the container reports the Azure SQL Database engine edition.
        containerName: form.containerName,
        containerEngine: engine,
        groupId: form.groupId,
        trustServerCertificate: true,
    } satisfies Partial<ConnectionProfile>);
    try {
        if (signal?.aborted) {
            return { success: false };
        }
        if (form.authenticationType === AuthenticationType.AzureMFA) {
            if (!form.accountId) {
                throw new Error(AzureSqlContainer.selectEntraAccount);
            }
            if (!form.tenantId) {
                throw new Error(ConnectionDialog.tenantIdIsRequired);
            }
            const account = await VsCodeAzureHelper.getAccountById(form.accountId);
            if (!account) {
                throw new Error(
                    Accounts.accountNotAvailableThroughVsCode(form.accountId, form.tenantId),
                );
            }
            Object.assign(connection, {
                authenticationType: AuthenticationType.AzureMFA,
                accountId: account.id,
                tenantId: form.tenantId,
                user: account.label,
                email: account.label,
                password: "",
                savePassword: false,
                emptyPasswordInput: true,
            } satisfies Partial<ConnectionProfile>);
        } else if (form.authenticationType === AuthenticationType.ActiveDirectoryDefault) {
            Object.assign(connection, {
                authenticationType: AuthenticationType.ActiveDirectoryDefault,
                tenantId: form.tenantId,
                user: "",
                password: "",
                savePassword: false,
                emptyPasswordInput: true,
            } satisfies Partial<ConnectionProfile>);
        } else if (form.authenticationType === AuthenticationType.ActiveDirectoryServicePrincipal) {
            if (!form.applicationId) {
                throw new Error(AzureSqlContainer.invalidApplicationClientId);
            }
            if (!form.tenantId) {
                throw new Error(ConnectionDialog.tenantIdIsRequired);
            }
            if (!form.servicePrincipalClientSecret?.trim()) {
                throw new Error(AzureSqlContainer.servicePrincipalClientSecretRequired);
            }
            Object.assign(connection, {
                authenticationType: AuthenticationType.ActiveDirectoryServicePrincipal,
                tenantId: form.tenantId,
                user: form.applicationId,
                password: form.servicePrincipalClientSecret,
                savePassword: false,
                emptyPasswordInput: false,
            } satisfies Partial<ConnectionProfile>);
        } else {
            Object.assign(connection, {
                authenticationType: sqlAuthentication,
                user: sa,
                password: form.password,
                savePassword: form.savePassword,
                emptyPasswordInput: false,
            } satisfies Partial<ConnectionProfile>);
        }
        if (
            !(await waitForContainerConnection(
                connection,
                form.containerName,
                mainController,
                signal,
            ))
        ) {
            return { success: false, error: AzureSqlContainer.connectContainerFailed };
        }
        const state = mainController.context.globalState;
        if (!connectedStores.has(state) && state.get<boolean>(firstConnectionKey, false) !== true) {
            // Claim before awaiting persistence to prevent duplicate concurrent milestones.
            connectedStores.add(state);
            sendActionEvent(TelemetryViews.AzureContainer, "FirstSuccessfulConnection", {
                connectionInfo: connection,
                serverInfo: mainController.connectionManager.getServerInfo(
                    connection,
                    connection.database ?? "",
                ),
                additionalProps: {
                    containerEngine:
                        Object.values(ContainerEngine).find((value) => value === engine) ??
                        "unknown",
                    hostArchitecture: os.arch(),
                    hostOS: os.platform(),
                    initiatedBy: "VSCode",
                },
            });
            try {
                await state.update(firstConnectionKey, true);
            } catch (error) {
                logger.error(`Failed to persist Azure SQL container adoption milestone: ${error}`);
            }
        }
        const profile = await mainController.connectionManager.connectionUI.saveProfile(connection);
        if (signal?.aborted) {
            return { success: false };
        }
        const connectionString = await mainController.connectionManager.getConnectionString(
            mainController.connectionManager.createConnectionDetails(profile),
            false,
            false,
        );
        if (signal?.aborted) {
            return { success: false };
        }
        await mainController.createObjectExplorerSession(profile);
        return { success: true, connectionString };
    } catch (error) {
        return {
            success: false,
            error: AzureSqlContainer.connectContainerFailed,
            fullErrorText: sanitizeProvisioningError(error, form),
        };
    }
}

async function resolveContainerEntraAdministrator(
    form: AzureSqlContainerForm,
): Promise<ContainerEntraAdministrator> {
    const identity = await acquireTokenFromVscodeAccountForResource(
        getCloudResourceEndpoint("armResource"),
        form.accountId,
        form.tenantId,
    );
    const parts = identity.session.accessToken.split(".");
    let claims: unknown;
    try {
        claims =
            parts.length === 3
                ? JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
                : undefined;
    } catch {
        throw new Error(AzureSqlContainer.invalidEntraAdministrator);
    }
    if (
        !claims ||
        typeof claims !== "object" ||
        !("oid" in claims) ||
        typeof claims.oid !== "string" ||
        !guidPattern.test(claims.oid) ||
        !("tid" in claims) ||
        typeof claims.tid !== "string" ||
        claims.tid.toLowerCase() !== form.tenantId?.toLowerCase() ||
        !identity.account.label.trim()
    ) {
        throw new Error(AzureSqlContainer.invalidEntraAdministrator);
    }
    return { id: claims.oid, name: identity.account.label.trim() };
}

export async function runAzureSqlContainerProvisioningStep(
    engine: ContainerEngine,
    step: AzureSqlContainerProvisioningStep,
    form: AzureSqlContainerForm,
    mainController: MainController,
    signal?: AbortSignal,
): Promise<AzureSqlContainerProvisioningResult> {
    try {
        switch (step) {
            case AzureSqlContainerProvisioningStep.PullImage: {
                const command = getAzureSqlContainerProvisioningCommand(engine, step, form);
                await executeContainerEngineCommand(command, 600_000, signal);
                return { success: true };
            }
            case AzureSqlContainerProvisioningStep.CreateContainer: {
                signal?.throwIfAborted();
                let administrator: ContainerEntraAdministrator | undefined;
                if (isAzureSqlContainerEntraAuthentication(form.authenticationType)) {
                    const validationError = Object.values(validateAzureSqlContainerForm(form))[0];
                    if (validationError) {
                        throw new Error(validationError);
                    }
                    if (!form.pfxFilePath || !(await fs.stat(form.pfxFilePath)).isFile()) {
                        throw new Error(AzureSqlContainer.pfxFileRequired);
                    }
                    await fs.access(form.pfxFilePath, fs.constants.R_OK);
                    signal?.throwIfAborted();
                    administrator = await resolveContainerEntraAdministrator(form);
                    signal?.throwIfAborted();
                }
                const command = getAzureSqlContainerProvisioningCommand(
                    engine,
                    step,
                    form,
                    administrator,
                );
                await executeContainerEngineCommand(command, 120_000, signal);
                return { success: true };
            }
            case AzureSqlContainerProvisioningStep.WaitForReady:
                return waitForAzureSqlContainer(engine, form, signal);
            case AzureSqlContainerProvisioningStep.Connect:
                return addAzureSqlContainerConnection(engine, form, mainController, signal);
        }
    } catch (error) {
        const errorMessage =
            step === AzureSqlContainerProvisioningStep.PullImage
                ? AzureSqlContainer.pullImageFailed
                : AzureSqlContainer.createContainerFailed;
        return {
            success: false,
            error: errorMessage,
            fullErrorText: sanitizeProvisioningError(error, form),
        };
    }
}
