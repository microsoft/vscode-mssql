/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    AzureSqlDatabaseRequests,
    ContainerEngine,
    ContainerEnginePrerequisite,
    ContainerEnginePrerequisiteResult,
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
    AzureSqlContainerProvisioningResult,
    AzureSqlContainerProvisioningStep,
} from "../sharedInterfaces/azureSqlDatabase";
import { getErrorMessage } from "../utils/utils";
import { DeploymentWebviewController } from "./deploymentWebviewController";
import { validateSqlServerPassword } from "./sqlServerContainer";
import { AzureSqlContainer } from "../constants/locConstants";
import * as dockerUtils from "../docker/dockerUtils";
import {
    defaultPortNumber,
    localhost,
    MAX_PORT_NUMBER,
    sa,
    sqlAuthentication,
} from "../constants/constants";
import { IConnectionProfile } from "../models/interfaces";
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
    validatePort,
    waitForContainerConnection,
    waitForContainerDelay,
} from "./localContainersHelpers";

const execFileAsync = promisify(execFile);
export const defaultAzureSqlContainerName = "azure_sql_db_container";
export const azureSqlContainerImage =
    "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest";
const containerReadyMessage = "ready for client connections";
const containerReadyTimeoutMs = 300_000;
const containerReadyPollIntervalMs = 2_000;
const containerProvisioningSteps = [
    AzureSqlContainerProvisioningStep.PullImage,
    AzureSqlContainerProvisioningStep.CreateContainer,
    AzureSqlContainerProvisioningStep.WaitForReady,
    AzureSqlContainerProvisioningStep.Connect,
] as const;

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
    deploymentController.onRequest(AzureSqlDatabaseRequests.PrepareContainerForm, async (form) => {
        const result = await prepareAzureSqlContainerForm(form);
        return {
            form: result.form,
            errors: { ...validateForm(result.form), ...result.errors },
        };
    });

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ValidateContainerPort,
        async ({ engine, port }) => validateAzureSqlContainerPort(engine, port),
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.GenerateContainerPort,
        async ({ engine, startPort }) => {
            const port = await findAvailableAzureSqlContainerPort(engine, startPort);
            if (port <= 0) {
                throw new Error(AzureSqlContainer.portDetectionFailed);
            }
            return port;
        },
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.GenerateContainerName, async () =>
        generateAzureSqlContainerName(),
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.DetectContainerEngines, async () =>
        detectContainerEngines(),
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.CheckContainerEnginePrerequisite,
        async (payload) => checkContainerEnginePrerequisite(payload.engine, payload.prerequisite),
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.RunContainerProvisioningStep,
        async (payload) => {
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

export async function findAvailableAzureSqlContainerPort(
    _engine: ContainerEngine,
    startPort = defaultPortNumber,
): Promise<number> {
    return dockerUtils.findAvailablePort(startPort);
}

export async function validateAzureSqlContainerPort(
    _engine: ContainerEngine,
    port: string,
): Promise<string | undefined> {
    if (!port) {
        return undefined;
    }
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > MAX_PORT_NUMBER) {
        return AzureSqlContainer.invalidPort;
    }

    return (await validatePort(port)) ? undefined : AzureSqlContainer.portInUse;
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
    } else {
        portError = await validateAzureSqlContainerPort(ContainerEngine.Docker, preparedForm.port);
    }
    const errors = validateAzureSqlContainerForm(preparedForm);
    if (portError) {
        errors.port = portError;
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
): Promise<void> {
    const startIndex = containerProvisioningSteps.indexOf(startStep);
    let currentStep = startStep;
    try {
        startProvisioningTask(
            deploymentController,
            DeploymentType.AzureSqlDatabase,
            AzureSqlContainer.provisioningTask,
            form.containerName,
        );

        for (const step of containerProvisioningSteps.slice(startIndex)) {
            currentStep = step;
            updateProvisioningTask(
                deploymentController,
                DeploymentType.AzureSqlDatabase,
                getProvisioningStepMessage(step),
            );
            const result = await executeStep(
                engine,
                step,
                form,
                deploymentController.mainController,
                signal,
            );
            onStepComplete(step, result);

            if (!result.success) {
                const canceled = signal.aborted;
                completeProvisioningTask(
                    deploymentController,
                    DeploymentType.AzureSqlDatabase,
                    canceled ? BackgroundTaskState.Canceled : BackgroundTaskState.Failed,
                    canceled
                        ? AzureSqlContainer.provisioningTaskCanceled(form.containerName)
                        : AzureSqlContainer.provisioningTaskFailed(
                              form.containerName,
                              result.error ?? AzureSqlContainer.createContainerFailed,
                          ),
                );
                return;
            }
        }
    } catch (error) {
        const errorMessage = sanitizeProvisioningError(error, form.password);
        onStepComplete(currentStep, {
            success: false,
            error: errorMessage,
            fullErrorText: errorMessage,
        });
        completeProvisioningTask(
            deploymentController,
            DeploymentType.AzureSqlDatabase,
            BackgroundTaskState.Failed,
            AzureSqlContainer.provisioningTaskFailed(form.containerName, errorMessage),
        );
        return;
    }

    completeProvisioningTask(
        deploymentController,
        DeploymentType.AzureSqlDatabase,
        BackgroundTaskState.Succeeded,
        AzureSqlContainer.provisioningTaskSucceeded(form.containerName),
    );
}

export async function generateAzureSqlContainerName(): Promise<string> {
    return dockerUtils.validateContainerName("", defaultAzureSqlContainerName);
}

export function validateAzureSqlContainerForm(
    form: AzureSqlContainerForm,
): AzureSqlContainerFormErrors {
    const errors: AzureSqlContainerFormErrors = {};
    const passwordError = validateSqlServerPassword(form.password);
    if (passwordError) {
        errors.password = passwordError;
    }
    if (!/^\d+$/.test(form.port) || Number(form.port) < 1 || Number(form.port) > 65535) {
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
        const result = await execFileAsync(command.executable, command.args, {
            timeout: 15_000,
            windowsHide: true,
        });

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

function getContainerEngineExecutable(engine: ContainerEngine): string {
    switch (engine) {
        case ContainerEngine.Docker:
            return "docker";
        case ContainerEngine.Podman:
            return "podman";
        case ContainerEngine.Containerd:
            return "nerdctl";
        case ContainerEngine.AppleContainer:
            return "container";
        case ContainerEngine.WslContainer:
            return "wslc";
    }
}

function getPullArguments(engine: ContainerEngine): string[] {
    return engine === ContainerEngine.AppleContainer
        ? ["image", "pull", azureSqlContainerImage]
        : ["pull", azureSqlContainerImage];
}

function getRunArguments(engine: ContainerEngine, form: AzureSqlContainerForm): string[] {
    const args = engine === ContainerEngine.AppleContainer ? ["run", "--detach"] : ["run", "-d"];
    args.push(
        "--name",
        form.containerName,
        "-e",
        "ACCEPT_EULA=Y",
        "-e",
        `MSSQL_SA_PASSWORD=${form.password}`,
        "-p",
        `${form.port}:1433`,
    );
    if (form.hostname) {
        args.push("--hostname", form.hostname);
    }
    args.push(azureSqlContainerImage);
    return args;
}

export function getAzureSqlContainerProvisioningCommand(
    engine: ContainerEngine,
    step:
        | AzureSqlContainerProvisioningStep.PullImage
        | AzureSqlContainerProvisioningStep.CreateContainer,
    form: AzureSqlContainerForm,
): PrerequisiteCommand {
    return {
        executable: getContainerEngineExecutable(engine),
        args:
            step === AzureSqlContainerProvisioningStep.PullImage
                ? getPullArguments(engine)
                : getRunArguments(engine, form),
    };
}

async function executeContainerEngineCommand(
    command: PrerequisiteCommand,
    timeout: number,
    signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(command.executable, command.args, {
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        signal,
    });
}

async function waitForAzureSqlContainer(
    engine: ContainerEngine,
    containerName: string,
    password: string,
    signal?: AbortSignal,
): Promise<AzureSqlContainerProvisioningResult> {
    const deadline = Date.now() + containerReadyTimeoutMs;
    let lastLogs = "";

    while (Date.now() < deadline && !signal?.aborted) {
        try {
            const result = await executeContainerEngineCommand(
                {
                    executable: getContainerEngineExecutable(engine),
                    args: ["logs", containerName],
                },
                15_000,
                signal,
            );
            lastLogs = `${result.stdout}\n${result.stderr}`;
            if (lastLogs.toLowerCase().includes(containerReadyMessage)) {
                return { success: true };
            }
        } catch (error) {
            lastLogs = getErrorMessage(error);
        }
        await waitForContainerDelay(containerReadyPollIntervalMs, signal);
    }

    return {
        success: false,
        error: AzureSqlContainer.containerNotReady,
        fullErrorText: sanitizeProvisioningError(lastLogs, password),
    };
}

function sanitizeProvisioningError(error: unknown, password: string): string {
    const errorText = typeof error === "string" ? error : getErrorMessage(error);
    const passwordRedactedText = password ? errorText.replaceAll(password, "******") : errorText;
    return dockerUtils.sanitizeErrorText(passwordRedactedText);
}

async function addAzureSqlContainerConnection(
    form: AzureSqlContainerForm,
    mainController: MainController,
    signal?: AbortSignal,
): Promise<AzureSqlContainerProvisioningResult> {
    const connection: unknown = {
        server: `${localhost},${form.port}`,
        profileName: form.profileName || form.containerName,
        groupId: form.groupId,
        password: form.password,
        savePassword: form.savePassword,
        emptyPasswordInput: false,
        authenticationType: sqlAuthentication,
        user: sa,
        trustServerCertificate: true,
    };

    try {
        if (signal?.aborted) {
            return { success: false };
        }
        if (
            !(await waitForContainerConnection(
                connection as IConnectionProfile,
                form.containerName,
                mainController,
                signal,
            ))
        ) {
            return { success: false, error: AzureSqlContainer.connectContainerFailed };
        }
        const profile = await mainController.connectionManager.connectionUI.saveProfile(
            connection as IConnectionProfile,
        );
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
            fullErrorText: sanitizeProvisioningError(error, form.password),
        };
    }
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
                const command = getAzureSqlContainerProvisioningCommand(engine, step, form);
                await executeContainerEngineCommand(command, 120_000, signal);
                return { success: true };
            }
            case AzureSqlContainerProvisioningStep.WaitForReady:
                return waitForAzureSqlContainer(engine, form.containerName, form.password, signal);
            case AzureSqlContainerProvisioningStep.Connect:
                return addAzureSqlContainerConnection(form, mainController, signal);
        }
    } catch (error) {
        const errorMessage =
            step === AzureSqlContainerProvisioningStep.PullImage
                ? AzureSqlContainer.pullImageFailed
                : AzureSqlContainer.createContainerFailed;
        return {
            success: false,
            error: errorMessage,
            fullErrorText: sanitizeProvisioningError(error, form.password),
        };
    }
}
