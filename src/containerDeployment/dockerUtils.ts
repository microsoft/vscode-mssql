/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { exec } from "child_process";
import { platform } from "os";
import {
    DockerCommandParams,
    DockerStep,
    DockerStepOrder,
} from "../sharedInterfaces/containerDeploymentInterfaces";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    connectionsArrayName,
    defaultContainerName,
    defaultContainerPort,
    extensionName,
    localhost,
    localhostIP,
    Platform,
} from "../constants/constants";
import { ContainerDeployment } from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";

const MAX_ERROR_TEXT_LENGTH = 300;

/**
 * Commands used to interact with Docker.
 */
export const COMMANDS = {
    CHECK_DOCKER: "docker --version",
    START_DOCKER: {
        win32: 'start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"',
        darwin: "open -a Docker",
        // still need to test
        linux: "systemctl start docker",
    },
    CHECK_ENGINE: {
        win32: `powershell -Command "& \\"C:\\Program Files\\Docker\\Docker\\DockerCli.exe\\" -SwitchLinuxEngine"`,
        darwin: `cat "${process.env.HOME}/Library/Group Containers/group.com.docker/settings-store.json" | grep '"UseVirtualizationFrameworkRosetta": true' || exit 1`,
        linux: "docker ps",
    },
    GET_CONTAINERS: `docker ps -a --format "{{.ID}}"`,
    INSPECT: (id: string) => `docker inspect ${id}`,
    START_SQL_SERVER: (
        name: string,
        password: string,
        port: number,
        version: number,
        hostname: string,
    ) =>
        `docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=${password}" -p ${port}:${defaultContainerPort} --name ${name} ${hostname ? `--hostname ${hostname}` : ""} -d mcr.microsoft.com/mssql/server:${version}-latest`,
    CHECK_CONTAINER_RUNNING: (name: string) =>
        `docker ps --filter "name=${name}" --filter "status=running" --format "{{.Names}}"`,
    VALIDATE_CONTAINER_NAME: 'docker ps -a --format "{{.Names}}"',
    START_CONTAINER: (name: string) => `docker start ${name}`,
    CHECK_LOGS: (name: string, platform: string) =>
        `docker logs --tail 15 ${name} | ${platform === "win32" ? 'findstr "Recovery is complete"' : 'grep "Recovery is complete"'}`,
    CHECK_CONTAINER_READY: `Recovery is complete`,
    STOP_CONTAINER: (name: string) => `docker stop ${name}`,
    DELETE_CONTAINER: (name: string) => `docker stop ${name} && docker rm ${name}`,
    INSPECT_CONTAINER: (id: string) => `docker inspect ${id}`,
};

/**
 * The steps for the Docker container deployment process.
 */
export function initializeDockerSteps(): DockerStep[] {
    return [
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: ContainerDeployment.dockerInstallHeader,
            bodyText: ContainerDeployment.dockerInstallBody,
            stepAction: checkDockerInstallation,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: ContainerDeployment.startDockerHeader,
            bodyText: ContainerDeployment.startDockerBody,
            stepAction: startDocker,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: ContainerDeployment.startDockerEngineHeader,
            bodyText: ContainerDeployment.startDockerEngineBody,
            stepAction: checkEngine,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: ["containerName", "password", "version", "hostname", "port"],
            headerText: ContainerDeployment.creatingContainerHeader,
            bodyText: ContainerDeployment.creatingContainerBody,
            stepAction: startSqlServerDockerContainer,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: ["containerName"],
            headerText: ContainerDeployment.settingUpContainerHeader,
            bodyText: ContainerDeployment.settingUpContainerBody,
            stepAction: checkIfContainerIsReadyForConnections,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: ContainerDeployment.connectingToContainerHeader,
            bodyText: ContainerDeployment.connectingToContainerBody,
            stepAction: undefined,
        },
    ];
}

/**
 * Handles the result of a Docker command and updates the corresponding step statuses accordingly.
 */
export function setStepStatusesFromResult(
    result: DockerCommandParams,
    currentStep: DockerStepOrder,
    steps: DockerStep[],
): DockerStep[] {
    if (result.success) {
        steps[currentStep].loadState = ApiStatus.Loaded;
    } else {
        steps[currentStep].loadState = ApiStatus.Error;
        steps[currentStep].errorMessage = result.error;
        steps[currentStep].fullErrorText = truncateErrorTextIfNeeded(result.fullErrorText);
        for (let i = currentStep + 1; i < steps.length; i++) {
            steps[i].loadState = ApiStatus.Error;
            steps[i].errorMessage = ContainerDeployment.previousStepFailed;
        }
    }
    return steps;
}

export function truncateErrorTextIfNeeded(errorText: string): string {
    if (errorText.length > MAX_ERROR_TEXT_LENGTH) {
        return `${errorText.substring(0, MAX_ERROR_TEXT_LENGTH)}...`;
    }
    return errorText;
}

/**
 * Container image versions available for SQL Server.
 */
export const sqlVersions = [
    { displayName: ContainerDeployment.sqlServer2025Image, value: "2025" },
    { displayName: ContainerDeployment.sqlServer2022Image, value: "2022" },
    { displayName: ContainerDeployment.sqlServer2019Image, value: "2019" },
    { displayName: ContainerDeployment.sqlServer2017Image, value: "2017" },
];

export function validateSqlServerPassword(password: string): string {
    if (password.length < 8) {
        return ContainerDeployment.passwordLengthError;
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
        return ContainerDeployment.passwordComplexityError;
    }

    return "";
}

/**
 * Checks if the provided connection name is valid and not a duplicate.
 */
export function validateConnectionName(connectionName: string): boolean {
    const connections = vscode.workspace
        .getConfiguration(extensionName)
        .get(connectionsArrayName, []);
    const isDuplicate = connections.some((profile) => profile.profileName === connectionName);
    return !isDuplicate;
}

//#region Docker Command Implementations

// Helper function to execute a command
async function execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout) => {
            if (error) return reject(error);
            resolve(stdout.trim());
        });
    });
}

export async function checkDockerInstallation(): Promise<DockerCommandParams> {
    try {
        await execCommand(COMMANDS.CHECK_DOCKER);
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error: ContainerDeployment.dockerInstallError,
            fullErrorText: e.message,
        };
    }
}

/**
 * Checks if the Docker engine is running and set up for running Linux containers.
 */
export async function checkEngine(): Promise<DockerCommandParams> {
    const engineCommand = COMMANDS.CHECK_ENGINE[platform()];
    if (engineCommand === undefined) {
        return {
            success: false,
            error: ContainerDeployment.unsupportedDockerPlatformError(platform()),
        };
    }

    try {
        await execCommand(engineCommand);
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error:
                platform() === Platform.Linux
                    ? ContainerDeployment.linuxDockerPermissionsError
                    : platform() === Platform.Mac
                      ? ContainerDeployment.rosettaError
                      : ContainerDeployment.windowsContainersError,
            fullErrorText: e.message,
        };
    }
}

/**
 * Checks that a container name is unique
 */
export async function validateContainerName(containerName: string): Promise<string> {
    try {
        const stdout = await execCommand(COMMANDS.VALIDATE_CONTAINER_NAME);
        const existingContainers = stdout ? stdout.split("\n") : [];
        let newContainerName = "";

        if (containerName.trim() === "") {
            newContainerName = defaultContainerName;
            let counter = 1;

            while (existingContainers.includes(newContainerName)) {
                newContainerName = `${defaultContainerName}_${++counter}`;
            }
        } else if (
            !existingContainers.includes(containerName) &&
            /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)
        ) {
            newContainerName = containerName;
        }

        return newContainerName;
    } catch {
        return containerName; // fallback in case of failure
    }
}

export async function startSqlServerDockerContainer(
    containerName: string,
    password: string,
    version: string,
    hostname: string,
    port: number,
): Promise<DockerCommandParams> {
    const command = COMMANDS.START_SQL_SERVER(
        containerName,
        password,
        port,
        Number(version),
        hostname,
    );
    console.log(command);
    try {
        await execCommand(command);
        console.log(`SQL Server container ${containerName} started on port ${port}.`);
        return {
            success: true,
            port,
        };
    } catch (e) {
        return {
            success: false,
            error: e.message,
            port: undefined,
            fullErrorText: e.message,
        };
    }
}

export async function isDockerContainerRunning(name: string): Promise<boolean> {
    try {
        const output = await execCommand(COMMANDS.CHECK_CONTAINER_RUNNING(name));
        return output.trim() === name;
    } catch {
        return false;
    }
}

/**
 * Attempts to start Docker Desktop within 30 seconds.
 */
export async function startDocker(): Promise<DockerCommandParams> {
    const startCommand = COMMANDS.START_DOCKER[platform()];

    if (!startCommand) {
        return {
            success: false,
            error: ContainerDeployment.unsupportedDockerPlatformError(platform()),
        };
    }

    try {
        await execCommand(startCommand);
        console.log("Waiting for Docker to start...");

        let attempts = 0;
        const maxAttempts = 30;
        const interval = 2000;

        return await new Promise((resolve) => {
            const checkDocker = setInterval(async () => {
                try {
                    await execCommand(COMMANDS.CHECK_DOCKER);
                    clearInterval(checkDocker);
                    resolve({ success: true });
                } catch (e) {
                    if (++attempts >= maxAttempts) {
                        clearInterval(checkDocker);
                        resolve({
                            success: false,
                            error: ContainerDeployment.dockerFailedToStartWithinTimeout,
                            fullErrorText: e.message,
                        });
                    }
                }
            }, interval);
        });
    } catch (e) {
        return {
            success: false,
            error: ContainerDeployment.dockerFailedToStartWithinTimeout,
            fullErrorText: e.message,
        };
    }
}

export async function restartContainer(containerName: string): Promise<boolean> {
    sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.StartContainer);

    const isDockerStarted = await startDocker();
    if (!isDockerStarted.success) return false;

    const containerRunning = await isDockerContainerRunning(containerName);
    if (containerRunning) return true;

    try {
        await execCommand(COMMANDS.START_CONTAINER(containerName));
        return (await checkIfContainerIsReadyForConnections(containerName)).success;
    } catch {
        return false;
    }
}

/**
 * Checks if the provided container is ready for connections by checking the logs.
 * It waits for a maximum of 60 seconds, checking every second.
 */
export async function checkIfContainerIsReadyForConnections(
    containerName: string,
): Promise<DockerCommandParams> {
    const timeoutMs = 60_000;
    const intervalMs = 1000;
    const start = Date.now();

    return new Promise((resolve) => {
        const interval = setInterval(async () => {
            try {
                const logs = await execCommand(COMMANDS.CHECK_LOGS(containerName, platform()));
                if (logs.includes(COMMANDS.CHECK_CONTAINER_READY)) {
                    clearInterval(interval);
                    return resolve({ success: true });
                }
            } catch {
                // Ignore error and retry until timeout
            }

            if (Date.now() - start > timeoutMs) {
                clearInterval(interval);
                return resolve({
                    success: false,
                    error: ContainerDeployment.containerFailedToStartWithinTimeout,
                });
            }
        }, intervalMs);
    });
}

export async function deleteContainer(containerName: string): Promise<boolean> {
    sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.DeleteContainer);

    try {
        await execCommand(COMMANDS.DELETE_CONTAINER(containerName));
        return true;
    } catch {
        return false;
    }
}

export async function stopContainer(containerName: string): Promise<boolean> {
    sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.StopContainer);

    try {
        await execCommand(COMMANDS.STOP_CONTAINER(containerName));
        return true;
    } catch {
        return false;
    }
}

async function getUsedPortsFromContainers(containerIds: string[]): Promise<Set<number>> {
    const usedPorts = new Set<number>();

    await Promise.all(
        containerIds.map(async (id) => {
            try {
                const inspect = await execCommand(COMMANDS.INSPECT_CONTAINER(id));
                const matches = inspect.match(/"HostPort":\s*"(\d+)"/g);
                matches?.forEach((match) => {
                    const port = match.match(/\d+/);
                    if (port) usedPorts.add(Number(port[0]));
                });
            } catch {
                // skip container if inspection fails
            }
        }),
    );

    return usedPorts;
}

async function findContainerByPort(containerIds: string[], serverName: string): Promise<string> {
    for (const id of containerIds) {
        try {
            const inspect = await execCommand(COMMANDS.INSPECT_CONTAINER(id));
            const ports = inspect.match(/"HostPort":\s*"(\d+)"/g);

            if (ports?.some((p) => serverName.includes(p.match(/\d+/)?.[0] || ""))) {
                const nameMatch = inspect.match(/"Name"\s*:\s*"\/([^"]+)"/);
                if (nameMatch) return nameMatch[1];
            }
        } catch {
            // skip container if inspection fails
        }
    }

    return "";
}

export async function checkIfConnectionIsDockerContainer(serverName: string): Promise<string> {
    if (!serverName.includes(localhost) && !serverName.includes(localhostIP)) return "";

    try {
        const stdout = await execCommand(COMMANDS.GET_CONTAINERS);
        const containerIds = stdout.split("\n").filter(Boolean);
        if (!containerIds.length) return "";

        return await findContainerByPort(containerIds, serverName);
    } catch {
        return "";
    }
}

export async function findAvailablePort(startPort: number): Promise<number> {
    try {
        const stdout = await execCommand(COMMANDS.GET_CONTAINERS);
        const containerIds = stdout.split("\n").filter(Boolean);
        if (!containerIds.length) return startPort;

        const usedPorts = await getUsedPortsFromContainers(containerIds);

        let port = startPort;
        while (usedPorts.has(port)) port++;
        return port;
    } catch {
        return -1;
    }
}

//#endregion
