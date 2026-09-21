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
import { localhost, sa, sqlAuthentication } from "../constants/constants";
import { IConnectionProfile } from "../models/interfaces";
import MainController from "../controllers/mainController";

const execFileAsync = promisify(execFile);
export const defaultAzureSqlContainerName = "azure_sql_db_container";
export const azureSqlContainerImage =
    "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest";
const containerReadyMessage = "ready for client connections";
const containerReadyTimeoutMs = 300_000;
const containerReadyPollIntervalMs = 2_000;
const activeProvisioningTasks = new WeakMap<
    DeploymentWebviewController,
    { abortController: AbortController; promise: Promise<AzureSqlContainerProvisioningResult> }
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
    deploymentController.onRequest(AzureSqlDatabaseRequests.ValidateContainerForm, async (form) => {
        const errors = validateAzureSqlContainerForm(form);
        if (
            !deploymentController.state.connectionGroupOptions.some(
                (group) => group.value === form.groupId,
            )
        ) {
            errors.groupId = AzureSqlContainer.selectConnectionGroup;
        }
        return errors;
    });

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
            const abortController = new AbortController();
            const promise = runAzureSqlContainerProvisioningStep(
                payload.engine,
                payload.step,
                payload.form,
                deploymentController.mainController,
                abortController.signal,
            );
            activeProvisioningTasks.set(deploymentController, {
                abortController,
                promise,
            });
            try {
                return await promise;
            } finally {
                if (activeProvisioningTasks.get(deploymentController)?.promise === promise) {
                    activeProvisioningTasks.delete(deploymentController);
                }
            }
        },
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.CancelContainerProvisioning, async () =>
        cancelAzureSqlContainerProvisioning(deploymentController),
    );
}

export async function cancelAzureSqlContainerProvisioning(
    deploymentController: DeploymentWebviewController,
): Promise<void> {
    const activeTask = activeProvisioningTasks.get(deploymentController);
    if (!activeTask) {
        return;
    }

    activeTask.abortController.abort();
    await activeTask.promise;
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

async function waitForDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
        return;
    }
    if (signal.aborted) {
        return;
    }

    await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
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
        await waitForDelay(containerReadyPollIntervalMs, signal);
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
