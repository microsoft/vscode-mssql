/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { arch, platform } from "os";
import axios from "axios";
import Docker from "dockerode";
import { DockerCommandParams, DockerStep } from "../sharedInterfaces/localContainers";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    defaultContainerName,
    defaultPortNumber,
    dockerDeploymentLoggerChannelName,
    Platform,
    windowsDockerDesktopExecutable,
    x64,
} from "../constants/constants";
import {
    LocalContainers,
    msgYes,
    ObjectExplorer,
    Common,
    RemoveProfileLabel,
} from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { FormItemOptions, FormItemValidationState } from "../sharedInterfaces/form";
import { getErrorMessage } from "../utils/utils";
import { Logger } from "../models/logger";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";

// Import from docker module (direct imports, no barrel file)
import { getDockerClient, pingDocker, getDockerInfo } from "../docker/dockerClient";
import {
    sanitizeContainerName,
    isContainerRunning,
    containerExists,
    startContainer,
    stopContainer as stopContainerRaw,
    removeContainer,
    streamContainerLogs,
    getContainerNameById,
    findAvailablePort,
    pullImage,
    createAndStartContainer,
    generateUniqueContainerName,
    validateContainerName as validateContainerNameGeneric,
} from "../docker/dockerOperations";
import {
    OS_COMMANDS,
    execCommand,
    execCommandWithPipe,
    getDockerExecutablePath,
    getStartDockerCommand,
} from "../docker/osCommands";

/**
 * The length of the year string in the version number
 */
const yearStringLength = 4;

/**
 * The SQL Server container image name
 */
const SQL_SERVER_IMAGE = "mcr.microsoft.com/mssql/server";

/**
 * MCR API endpoint for SQL Server container tags
 */
const MCR_TAGS_API = "https://mcr.microsoft.com/v2/mssql/server/tags/list";

/**
 * Message to check in SQL Server logs to determine if the server is ready
 */
const SQL_SERVER_READY_MESSAGE = "Recovery is complete";

export const invalidContainerNameValidationResult: FormItemValidationState = {
    isValid: false,
    validationMessage: LocalContainers.pleaseChooseUniqueContainerName,
};

export const invalidPortNumberValidationResult: FormItemValidationState = {
    isValid: false,
    validationMessage: LocalContainers.pleaseChooseUnusedPort,
};

export const dockerLogger = Logger.create(
    vscode.window.createOutputChannel(dockerDeploymentLoggerChannelName),
);

const dockerInstallErrorLink = "https://www.docker.com/products/docker-desktop/";

// Exported for testing purposes
export const windowsContainersErrorLink =
    "https://learn.microsoft.com/en-us/virtualization/windowscontainers/deploy-containers/set-up-linux-containers";
export const rosettaErrorLink =
    "https://docs.docker.com/desktop/settings-and-maintenance/settings/#general";

// Re-export commonly used functions from docker module for backward compatibility
export {
    getDockerClient,
    sanitizeContainerName as sanitizeContainerInput,
    findAvailablePort,
    isContainerRunning as isDockerContainerRunning,
};

// Export COMMANDS for backward compatibility (used in tests)
export const COMMANDS = {
    CHECK_CONTAINER_READY: SQL_SERVER_READY_MESSAGE,
};

// Note: stopContainer is exported as stopDockerContainer below (returns boolean with telemetry)

/**
 * The steps for the Docker container deployment process.
 */
export function initializeDockerSteps(): DockerStep[] {
    return [
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: LocalContainers.dockerInstallHeader,
            bodyText: LocalContainers.dockerInstallBody,
            errorLink: dockerInstallErrorLink,
            errorLinkText: LocalContainers.installDocker,
            stepAction: checkDockerInstallation,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: LocalContainers.startDockerHeader,
            bodyText: LocalContainers.startDockerBody,
            stepAction: startDocker,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: LocalContainers.startDockerEngineHeader,
            bodyText: LocalContainers.startDockerEngineBody,
            errorLink: getEngineErrorLink(),
            errorLinkText: getEngineErrorLinkText(),
            stepAction: checkEngine,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: ["version"],
            headerText: LocalContainers.pullImageHeader,
            bodyText: LocalContainers.pullImageBody,
            stepAction: pullSqlServerContainerImage,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: ["containerName", "password", "version", "hostname", "port"],
            headerText: LocalContainers.creatingContainerHeader,
            bodyText: LocalContainers.creatingContainerBody,
            stepAction: startSqlServerDockerContainer,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: ["containerName"],
            headerText: LocalContainers.settingUpContainerHeader,
            bodyText: LocalContainers.settingUpContainerBody,
            stepAction: checkIfContainerIsReadyForConnections,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: LocalContainers.connectingToContainerHeader,
            bodyText: LocalContainers.connectingToContainerBody,
            stepAction: undefined,
        },
    ];
}

/**
 * Gets the link to the Docker engine error documentation based on the platform and architecture.
 */
export function getEngineErrorLink(): string | undefined {
    if (platform() === Platform.Windows && arch() === x64) {
        return windowsContainersErrorLink;
    } else if (platform() === Platform.Mac && arch() !== x64) {
        return rosettaErrorLink;
    }
    return undefined;
}

/**
 * Gets the text to the Docker engine error documentation based on the platform and architecture.
 */
export function getEngineErrorLinkText(): string | undefined {
    if (platform() === Platform.Windows && arch() === x64) {
        return LocalContainers.configureLinuxContainers;
    } else if (platform() === Platform.Mac && arch() !== x64) {
        return LocalContainers.configureRosetta;
    }
    return undefined;
}

/**
 * Sanitizes sensitive info from error text (masks SA_PASSWORD).
 */
export function sanitizeErrorText(errorText: string): string {
    return errorText.replace(/(SA_PASSWORD=)([^ \n]+)/gi, '$1******"');
}

/**
 * Checks if the SQL Server password meets the complexity requirements.
 */
export function validateSqlServerPassword(password: string): string {
    if (password.length < 8 || password.length > 128) {
        return LocalContainers.passwordLengthError;
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*]/.test(password);

    const categoryCount = [hasUpperCase, hasLowerCase, hasDigit, hasSpecialChar].filter(
        Boolean,
    ).length;

    if (categoryCount < 3) {
        return LocalContainers.passwordComplexityError;
    }

    return "";
}

/**
 * Constructs the SQL Server version tag (e.g., "2022-latest")
 */
export function constructVersionTag(version: string): string {
    const versionYear = version.substring(0, yearStringLength);
    return `${versionYear}-latest`;
}

//#region Docker Installation & Engine Checks

/**
 * Checks if docker is installed and the daemon is accessible
 */
export async function checkDockerInstallation(): Promise<DockerCommandParams> {
    try {
        const dockerApi = getDockerClient();
        await dockerApi.version();
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error: LocalContainers.dockerInstallError,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Checks if the Docker engine is running and ready to run containers.
 * On Windows, checks if the Docker Engine is set to use Linux containers.
 * On macOS, checks if Rosetta is enabled for ARM64 architecture.
 * On Linux, checks for permissions to run Docker commands.
 */
export async function checkEngine(): Promise<DockerCommandParams> {
    // No need to check Rosetta on x64 macOS
    if (platform() === Platform.Mac && arch() === x64) {
        return { success: true };
    }

    // Only x64 and Apple Silicon (arm64) are supported
    if (platform() !== Platform.Mac && arch() !== x64) {
        return {
            success: false,
            error: LocalContainers.unsupportedDockerArchitectureError(arch()),
        };
    }

    let dockerCliPath = "";
    if (platform() === Platform.Windows) {
        dockerCliPath = await getDockerExecutablePath("DockerCli.exe");
    }

    try {
        if (platform() === Platform.Windows) {
            const info = await getDockerInfo();
            const osType = info.OSType;

            if (osType !== Platform.Linux) {
                const confirmation = await vscode.window.showInformationMessage(
                    LocalContainers.switchToLinuxContainersConfirmation,
                    { modal: true },
                    msgYes,
                );
                if (confirmation === msgYes) {
                    await execCommand(OS_COMMANDS.SWITCH_TO_LINUX_ENGINE(dockerCliPath));
                } else {
                    throw new Error(LocalContainers.switchToLinuxContainersCanceled);
                }
            }
        } else if (platform() === Platform.Mac) {
            // Check Rosetta setting from Docker Desktop settings file
            const rosettaCheck = OS_COMMANDS.CHECK_ROSETTA;
            await execCommandWithPipe(rosettaCheck.dockerCmd, rosettaCheck.grepCmd);
        } else {
            // Linux - verify we can list containers
            const dockerApi = getDockerClient();
            await dockerApi.listContainers();
        }
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error:
                platform() === Platform.Linux
                    ? LocalContainers.linuxDockerPermissionsError
                    : platform() === Platform.Mac
                      ? LocalContainers.rosettaError
                      : LocalContainers.windowsContainersError,
            fullErrorText: getErrorMessage(e),
        };
    }
}

//#endregion

//#region Docker Desktop Startup

/**
 * Attempts to start Docker Desktop within 60 seconds.
 */
export async function startDocker(
    node?: ConnectionNode,
    objectExplorerService?: ObjectExplorerService,
): Promise<DockerCommandParams> {
    // Check if Docker is already running
    const isRunning = await pingDocker();
    if (isRunning) {
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.StartDocker, {
            dockerStartedThroughExtension: "false",
        });
        return { success: true };
    }

    // Update UI if node context is provided
    if (node && objectExplorerService) {
        node.loadingLabel = LocalContainers.startingDockerLoadingLabel;
        await objectExplorerService.setLoadingUiForNode(node);
    }

    // Get Docker Desktop path on Windows
    let dockerDesktopPath = "";
    if (platform() === Platform.Windows) {
        dockerDesktopPath = await getDockerExecutablePath(windowsDockerDesktopExecutable);
        if (!dockerDesktopPath) {
            return {
                success: false,
                error: LocalContainers.dockerDesktopPathError,
            };
        }
    }

    // Get the appropriate start command for this platform
    const startCommand = getStartDockerCommand(dockerDesktopPath);
    if (!startCommand) {
        return {
            success: false,
            error: LocalContainers.unsupportedDockerPlatformError(platform()),
        };
    }

    try {
        dockerLogger.appendLine("Waiting for Docker to start...");
        await execCommand(startCommand);

        // Poll for Docker to be ready
        let attempts = 0;
        const maxAttempts = 30;
        const intervalMs = 2000;

        return await new Promise((resolve) => {
            const checkDocker = setInterval(async () => {
                try {
                    const running = await pingDocker();
                    if (running) {
                        clearInterval(checkDocker);
                        dockerLogger.appendLine("Docker started successfully.");
                        sendActionEvent(
                            TelemetryViews.LocalContainers,
                            TelemetryActions.StartDocker,
                            { dockerStartedThroughExtension: "true" },
                        );
                        resolve({ success: true });
                    } else if (++attempts >= maxAttempts) {
                        clearInterval(checkDocker);
                        resolve({
                            success: false,
                            error: LocalContainers.dockerFailedToStartWithinTimeout,
                        });
                    }
                } catch (e) {
                    if (++attempts >= maxAttempts) {
                        clearInterval(checkDocker);
                        resolve({
                            success: false,
                            error: LocalContainers.dockerFailedToStartWithinTimeout,
                            fullErrorText: getErrorMessage(e),
                        });
                    }
                }
            }, intervalMs);
        });
    } catch (e) {
        return {
            success: false,
            error: LocalContainers.dockerFailedToStartWithinTimeout,
            fullErrorText: getErrorMessage(e),
        };
    }
}

//#endregion

//#region SQL Server Container Operations

/**
 * Validates and potentially generates a unique container name.
 */
export async function validateContainerName(containerName: string): Promise<string> {
    if (containerName.trim() === "") {
        return generateUniqueContainerName(defaultContainerName);
    }

    const validatedName = await validateContainerNameGeneric(containerName);
    return validatedName;
}

/**
 * Pulls the SQL Server container image for the specified version.
 */
export async function pullSqlServerContainerImage(version: string): Promise<DockerCommandParams> {
    try {
        const imageTag = `${SQL_SERVER_IMAGE}:${constructVersionTag(version)}`;
        dockerLogger.appendLine(`Pulling image: ${imageTag}`);

        await pullImage(imageTag, (event) => {
            if (event.status) {
                dockerLogger.appendLine(
                    `${event.status}${event.progress ? ` ${event.progress}` : ""}`,
                );
            }
        });

        dockerLogger.appendLine(`Image ${imageTag} pulled successfully.`);
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error: LocalContainers.pullSqlServerContainerImageError,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Starts a SQL Server Docker container with the specified parameters.
 */
export async function startSqlServerDockerContainer(
    containerName: string,
    password: string,
    version: string,
    hostname: string,
    port: number,
): Promise<DockerCommandParams> {
    try {
        const imageTag = `${SQL_SERVER_IMAGE}:${constructVersionTag(version)}`;
        const sanitizedName = sanitizeContainerName(containerName);

        const containerConfig: Docker.ContainerCreateOptions = {
            Image: imageTag,
            name: sanitizedName,
            Env: ["ACCEPT_EULA=Y", `SA_PASSWORD=${password}`],
            HostConfig: {
                PortBindings: {
                    [`${defaultPortNumber}/tcp`]: [{ HostPort: `${port}` }],
                },
            },
        };

        if (hostname) {
            containerConfig.Hostname = sanitizeContainerName(hostname);
        }

        await createAndStartContainer(containerConfig);

        dockerLogger.append(`SQL Server container ${sanitizedName} started on port ${port}.`);
        return {
            success: true,
            port,
        };
    } catch (e) {
        return {
            success: false,
            error: LocalContainers.startSqlServerContainerError,
            port: undefined,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Checks if the provided container is ready for connections by streaming the logs.
 * Uses Docker's streaming API instead of polling for better efficiency.
 * It waits for a maximum of 5 minutes.
 */
export async function checkIfContainerIsReadyForConnections(
    containerName: string,
): Promise<DockerCommandParams> {
    const timeoutMs = 300_000; // 5 minutes
    const start = Date.now();

    dockerLogger.appendLine(`Checking if container ${containerName} is ready for connections...`);

    return new Promise(async (resolve) => {
        let cleanup: (() => void) | undefined;
        let resolved = false;
        // Accumulate log data to handle messages split across chunks
        let logBuffer = "";

        // Set up timeout
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                if (cleanup) {
                    cleanup();
                }
                resolve({
                    success: false,
                    error: LocalContainers.containerFailedToStartWithinTimeout,
                });
            }
        }, timeoutMs);

        // Stream logs and watch for ready message
        cleanup = await streamContainerLogs(
            containerName,
            (chunk: string) => {
                if (resolved) {
                    return;
                }
                logBuffer += chunk;
                if (logBuffer.includes(SQL_SERVER_READY_MESSAGE)) {
                    resolved = true;
                    clearTimeout(timeout);
                    if (cleanup) {
                        cleanup();
                    }
                    dockerLogger.appendLine(`${containerName} is ready for connections!`);
                    resolve({ success: true });
                }
            },
            (error: Error) => {
                // Log error but don't fail immediately - container might still be starting
                dockerLogger.appendLine(`Log stream error: ${error.message}`);
            },
            Math.floor(start / 1000),
        );
        cleanup();
    });
}

/**
 * Deletes a Docker container with the specified name.
 */
export async function deleteContainer(containerName: string): Promise<boolean> {
    try {
        try {
            await stopContainerRaw(containerName);
        } catch {
            // Container might already be stopped
        }
        await removeContainer(containerName);

        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.DeleteContainer);
        return true;
    } catch (e) {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.DeleteContainer,
            e,
            false,
            undefined,
            undefined,
        );
        return false;
    }
}

/**
 * Stops a Docker container with the specified name.
 * @deprecated Use stopDockerContainer instead
 */
export const stopContainer = stopDockerContainerWithTelemetry;

/**
 * Stops a Docker container with the specified name (with telemetry).
 */
export async function stopDockerContainerWithTelemetry(containerName: string): Promise<boolean> {
    try {
        await stopContainerRaw(containerName);
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.StopContainer);
        return true;
    } catch (e) {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.StopContainer,
            e,
            false,
            undefined,
            undefined,
        );
        return false;
    }
}

/**
 * Stops a Docker container with the specified name.
 */
export async function stopDockerContainer(containerName: string): Promise<boolean> {
    return stopDockerContainerWithTelemetry(containerName);
}

/**
 * Restarts a Docker container with the specified name.
 */
export async function restartContainer(
    containerName: string,
    containerNode: ConnectionNode,
    objectExplorerService: ObjectExplorerService,
): Promise<boolean> {
    const dockerPreparedResult = await prepareForDockerContainerCommand(
        containerName,
        containerNode,
        objectExplorerService,
    );
    if (!dockerPreparedResult.success) {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.RestartContainer,
            new Error(dockerPreparedResult.error),
            false,
            undefined,
            undefined,
        );
        return false;
    }

    const running = await isContainerRunning(containerName);
    if (running) {
        return true; // Container is already running
    }

    containerNode.loadingLabel = LocalContainers.startingContainerLoadingLabel;
    await objectExplorerService.setLoadingUiForNode(containerNode);
    dockerLogger.appendLine(`Restarting container: ${containerName}`);

    try {
        await startContainer(containerName);

        dockerLogger.appendLine(`Container ${containerName} restarted successfully.`);
        containerNode.loadingLabel = LocalContainers.readyingContainerLoadingLabel;
        await objectExplorerService.setLoadingUiForNode(containerNode);

        const containerReadyResult = await checkIfContainerIsReadyForConnections(containerName);

        containerNode.loadingLabel = ObjectExplorer.LoadingNodeLabel;
        await objectExplorerService.setLoadingUiForNode(containerNode);

        if (!containerReadyResult.success) {
            sendErrorEvent(
                TelemetryViews.LocalContainers,
                TelemetryActions.RestartContainer,
                new Error(containerReadyResult.error),
                false,
                undefined,
                undefined,
            );
            return false;
        }
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.RestartContainer);
        return true;
    } catch (e) {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.RestartContainer,
            e,
            false,
            undefined,
            undefined,
        );
        return false;
    }
}

//#endregion

//#region SQL Server Version Discovery

/**
 * Retrieves all raw SQL Server container tags from the Microsoft Container Registry.
 */
export async function getAllSqlServerContainerTags(): Promise<string[]> {
    try {
        const response = await axios.get<{ tags?: string[] }>(MCR_TAGS_API, {
            timeout: 10000,
        });
        return (response.data.tags ?? []).filter((tag: string) => tag);
    } catch (e) {
        dockerLogger.appendLine(`Error fetching SQL Server container tags: ${getErrorMessage(e)}`);
        return [];
    }
}

/**
 * Retrieves the SQL Server container versions from the Microsoft Container Registry.
 * Returns a simplified year-based list (2025, 2022, 2019, 2017) for the deployment UI.
 */
export async function getSqlServerContainerVersions(): Promise<FormItemOptions[]> {
    try {
        const tags = await getAllSqlServerContainerTags();

        const versions: string[] = [];
        const yearSet = new Set<string>();

        for (const tag of tags) {
            if (!tag) continue;

            versions.push(tag);

            const year = tag.slice(0, 4);
            if (/^\d{4}$/.test(year)) {
                yearSet.add(year);
            }
        }

        const uniqueYears = Array.from(yearSet);
        const latestVersionIndex = versions.length - 4;
        const latestImage = versions[latestVersionIndex];

        const versionOptions = uniqueYears
            .map((year) => ({
                displayName: LocalContainers.sqlServerVersionImage(year),
                value: year,
            }))
            .reverse();

        versionOptions[0].value = latestImage;

        return versionOptions;
    } catch (e) {
        dockerLogger.appendLine(
            `Error parsing SQL Server container versions: ${getErrorMessage(e)}`,
        );
        return [];
    }
}

//#endregion

//#region Container Helpers

/**
 * Prepares the given Docker container for command execution.
 * This function checks if Docker is running and if the specified container exists.
 */
export async function prepareForDockerContainerCommand(
    containerName: string,
    containerNode: ConnectionNode,
    objectExplorerService: ObjectExplorerService,
): Promise<DockerCommandParams> {
    const startDockerResult = await startDocker(containerNode, objectExplorerService);
    if (!startDockerResult.success) {
        vscode.window.showErrorMessage(startDockerResult.error);
        return startDockerResult;
    }

    const exists = await containerExists(containerName);
    if (!exists) {
        containerNode.loadingLabel = Common.error;
        await objectExplorerService.setLoadingUiForNode(containerNode);
        const confirmation = await vscode.window.showInformationMessage(
            LocalContainers.containerDoesNotExistError,
            { modal: true },
            RemoveProfileLabel,
        );
        if (confirmation === RemoveProfileLabel) {
            await objectExplorerService.removeNode(containerNode, false);
        }
        return {
            success: false,
            error: LocalContainers.containerDoesNotExistError,
        };
    }

    return { success: true };
}

/**
 * Checks if a Docker container with the specified name exists.
 */
export async function checkContainerExists(name: string): Promise<boolean> {
    try {
        return await containerExists(name);
    } catch (e) {
        dockerLogger.appendLine(`Error checking if container exists: ${getErrorMessage(e)}`);
        return false;
    }
}

/**
 * Determines whether a connection is running inside a Docker container.
 */
export async function checkIfConnectionIsDockerContainer(machineName: string): Promise<string> {
    return getContainerNameById(machineName);
}

/**
 * Finds the path to the given Docker executable (for backward compatibility).
 */
export async function getDockerPath(executable: string): Promise<string> {
    return getDockerExecutablePath(executable);
}

//#endregion
