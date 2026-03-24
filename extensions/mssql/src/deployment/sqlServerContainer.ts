/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerCommandParams, DockerStep } from "../sharedInterfaces/localContainers";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    defaultPortNumber,
    sqlServerDockerRegistry,
    sqlServerDockerRepository,
} from "../constants/constants";
import { LocalContainers, ObjectExplorer } from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { FormItemOptions } from "../sharedInterfaces/form";
import { getErrorMessage } from "../utils/utils";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";
import type Dockerode from "dockerode";
import { getDockerodeClient } from "../docker/dockerodeClient";
import {
    DockerCommand,
    checkDockerInstallation,
    checkEngine,
    dockerInstallErrorLink,
    dockerLogger,
    execDockerCommand,
    getContainerByName,
    getEngineErrorLink,
    getEngineErrorLinkText,
    isDockerContainerRunning,
    prepareForDockerContainerCommand,
    pullContainerImage,
    sanitizeContainerInput,
    startContainerLogMonitor,
    startDocker,
} from "../docker/dockerUtils";

/**
 * The length of the year string in the version number
 */
const yearStringLength = 4;

/**
 * SQL Server-specific commands.
 */
export const SQL_SERVER_COMMANDS = {
    CHECK_CONTAINER_READY: `SQL Server is now ready for client connections`,
    CHECK_CONTAINER_LISTENING_ON_SQL_PORT: `Server is listening on`,
    CHECK_CONTAINER_RECOVERY_COMPLETE: `Recovery is complete`,
    GET_SQL_SERVER_CONTAINER_VERSIONS: (): DockerCommand => ({
        command: "curl",
        args: ["-s", "https://mcr.microsoft.com/v2/mssql/server/tags/list"],
    }),
};

const sqlServerLogMonitorBufferLength = 32 * 1024;
const sqlServerReadinessPollIntervalMs = 250;

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
            stepAction: checkIfSqlServerContainerIsReadyForConnections,
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
 * Temp fix for the SQL Server 2025 version issue on Mac.
 * Returns the last working version of SQL Server 2025 for Mac.
 */
export function constructVersionTag(version: string): string {
    let versionYear = version.substring(0, yearStringLength);
    return `${versionYear}-latest`;
}

function getSqlServerImageName(versionTag: string): string {
    return `${sqlServerDockerRegistry}/${sqlServerDockerRepository}:${versionTag}`;
}

function getContainerStartTimestampSeconds(
    containerInspectInfo: Dockerode.ContainerInspectInfo,
): number {
    const startedAt = containerInspectInfo.State?.StartedAt;
    const startedAtMilliseconds = startedAt ? Date.parse(startedAt) : NaN;

    if (Number.isNaN(startedAtMilliseconds)) {
        return Math.floor(Date.now() / 1000);
    }

    return Math.floor(startedAtMilliseconds / 1000);
}

async function waitForSqlServerReadinessMarkers(
    logMonitor: { getLogs: () => string | undefined },
    timeoutMs: number,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const logs = logMonitor.getLogs() ?? "";

        if (logs.includes(SQL_SERVER_COMMANDS.CHECK_CONTAINER_READY)) {
            return true;
        }

        const isListeningOnSqlPort =
            logs.includes(SQL_SERVER_COMMANDS.CHECK_CONTAINER_LISTENING_ON_SQL_PORT) &&
            /Server is listening on .*1433.*accept sockets/i.test(logs);
        if (
            isListeningOnSqlPort &&
            logs.includes(SQL_SERVER_COMMANDS.CHECK_CONTAINER_RECOVERY_COMPLETE)
        ) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, sqlServerReadinessPollIntervalMs));
    }

    return false;
}

/**
 * Checks if the SQL Server password meets the complexity requirements.
 * If the password is valid, it returns the validation message, which is an empty string.
 * If the password is invalid, it returns an error message.
 */
export function validateSqlServerPassword(password: string): string {
    if (password.length < 8 || password.length > 128) {
        return LocalContainers.passwordLengthError;
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*]/.test(password);

    // Count the number of required character categories met
    const categoryCount = [hasUpperCase, hasLowerCase, hasDigit, hasSpecialChar].filter(
        Boolean,
    ).length;

    if (categoryCount < 3) {
        return LocalContainers.passwordComplexityError;
    }

    return "";
}

/**
 * Pulls the SQL Server container image for the specified version.
 */
export async function pullSqlServerContainerImage(version: string): Promise<DockerCommandParams> {
    const imageTag = constructVersionTag(version);
    const imageName = getSqlServerImageName(imageTag);
    return pullContainerImage(imageName, LocalContainers.pullSqlServerContainerImageError);
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
        const dockerClient = getDockerodeClient();
        const safeContainerName = sanitizeContainerInput(containerName);
        const safeHostname = hostname ? sanitizeContainerInput(hostname) : undefined;
        const imageTag = constructVersionTag(version);
        const imageName = getSqlServerImageName(imageTag);
        const sqlContainerPort = `${defaultPortNumber}/tcp`;
        const hostPort = `${port}`;
        const containerEnvironment = ["ACCEPT_EULA=Y", `SA_PASSWORD=${password}`];
        const createContainerOptions: Dockerode.ContainerCreateOptions = {
            Image: imageName,
            name: safeContainerName,
            Env: containerEnvironment,
            ExposedPorts: {
                [sqlContainerPort]: {},
            },
            HostConfig: {
                PortBindings: {
                    [sqlContainerPort]: [{ HostPort: hostPort }],
                },
            },
        };
        if (safeHostname) {
            createContainerOptions.Hostname = safeHostname;
        }

        const container = await dockerClient.createContainer(createContainerOptions);
        await container.start();
        dockerLogger.append(`SQL Server container ${containerName} started on port ${port}.`);
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
 * Restarts a Docker container with the specified name.
 * If the container is already running, it returns true without restarting.
 */
export async function restartSqlServerContainer(
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
            false, // includeErrorMessage
            undefined, // errorCode
            undefined, // errorType
        );
        return false;
    }
    const isContainerRunning = await isDockerContainerRunning(containerName);

    if (isContainerRunning) return true; // Container is already running
    containerNode.loadingLabel = LocalContainers.startingContainerLoadingLabel;
    await objectExplorerService.setLoadingUiForNode(containerNode);
    dockerLogger.appendLine(`Restarting container: ${containerName}`);
    const container = await getContainerByName(containerName);
    if (!container) {
        throw new Error(`Container ${containerName} does not exist.`);
    }
    await container.start();

    dockerLogger.appendLine(`Container ${containerName} restarted successfully.`);
    containerNode.loadingLabel = LocalContainers.readyingContainerLoadingLabel;
    await objectExplorerService.setLoadingUiForNode(containerNode);

    const containerReadyResult =
        await checkIfSqlServerContainerIsReadyForConnections(containerName);

    containerNode.loadingLabel = ObjectExplorer.LoadingNodeLabel;
    await objectExplorerService.setLoadingUiForNode(containerNode);

    if (!containerReadyResult.success) {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.RestartContainer,
            new Error(containerReadyResult.error),
            false, // includeErrorMessage
            undefined, // errorCode
            undefined, // errorType
        );
        return false;
    }
    sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.RestartContainer);
    return true;
}

/**
 * Checks if the provided container is ready for connections by checking the logs.
 * It waits up to 5 minutes while streaming log chunks.
 */
export async function checkIfSqlServerContainerIsReadyForConnections(
    containerName: string,
): Promise<DockerCommandParams> {
    const timeoutMs = 300_000; // 5 minutes

    dockerLogger.appendLine(`Checking if container ${containerName} is ready for connections...`);

    try {
        const container = await getContainerByName(containerName);
        if (!container) {
            return {
                success: false,
                error: LocalContainers.containerFailedToStartWithinTimeout,
            };
        }

        const containerInspectInfo = await container.inspect();
        const startTimestampSeconds = getContainerStartTimestampSeconds(containerInspectInfo);

        const logMonitor = await startContainerLogMonitor(container, {
            since: startTimestampSeconds,
            maxBufferLength: sqlServerLogMonitorBufferLength,
        });
        let isReady = false;
        try {
            isReady = await waitForSqlServerReadinessMarkers(logMonitor, timeoutMs);
        } finally {
            logMonitor.dispose();
        }
        if (isReady) {
            dockerLogger.appendLine(`${containerName} is ready for connections!`);
            return { success: true };
        }
    } catch (e) {
        dockerLogger.appendLine(
            `Error while checking readiness for ${containerName}: ${getErrorMessage(e)}`,
        );
    }

    return {
        success: false,
        error: LocalContainers.containerFailedToStartWithinTimeout,
    };
}

/**
 * Retrieves all raw SQL Server container tags from the Microsoft Container Registry.
 * @returns the complete list of available tags without filtering or processing.
 */
export async function getAllSqlServerContainerTags(): Promise<string[]> {
    try {
        const stdout = await execDockerCommand(
            SQL_SERVER_COMMANDS.GET_SQL_SERVER_CONTAINER_VERSIONS(),
        );
        const parsed = JSON.parse(stdout);
        return (parsed.tags ?? []).filter((tag: string) => tag);
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

        const yearSet = new Set<string>();

        for (const tag of tags) {
            if (!tag) continue;

            const year = tag.slice(0, 4);
            if (/^\d{4}$/.test(year)) {
                yearSet.add(year);
            }
        }

        return Array.from(yearSet)
            .sort((left, right) => Number(right) - Number(left))
            .map((year) => ({
                displayName: LocalContainers.sqlServerVersionImage(year),
                value: year,
            }));
    } catch (e) {
        dockerLogger.appendLine(
            `Error parsing SQL Server container versions: ${getErrorMessage(e)}`,
        );
        return [];
    }
}
