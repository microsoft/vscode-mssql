/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { exec } from "child_process";
import { arch, platform } from "os";
import { DockerCommandParams, DockerStep } from "../sharedInterfaces/containerDeploymentInterfaces";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    defaultContainerName,
    defaultPortNumber,
    localhost,
    localhostIP,
    Platform,
    x64,
} from "../constants/constants";
import { ContainerDeployment, msgYes } from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";
import * as path from "path";
import { FormItemOptions, FormItemValidationState } from "../sharedInterfaces/form";
import { getErrorMessage } from "../utils/utils";
import { Logger } from "../models/logger";

/**
 * The maximum port number that can be used for Docker containers.
 */
const MAX_PORT_NUMBER = 65535;

export const invalidContainerNameValidationResult: FormItemValidationState = {
    isValid: false,
    validationMessage: ContainerDeployment.pleaseChooseUniqueContainerName,
};
export const invalidPortNumberValidationResult: FormItemValidationState = {
    isValid: false,
    validationMessage: ContainerDeployment.pleaseChooseUnusedPort,
};

export const dockerLogger = Logger.create(vscode.window.createOutputChannel("Docker Deployment"));

/**
 * Commands used to interact with Docker.
 */
export const COMMANDS = {
    CHECK_DOCKER: "docker --version",
    CHECK_DOCKER_RUNNING: "docker info",
    GET_DOCKER_PATH: 'powershell -Command "(Get-Command docker).Source"',
    START_DOCKER: (path: string) => ({
        win32: `start "" "${path}"`,
        darwin: "open -a Docker",
        linux: "systemctl start docker",
    }),
    CHECK_ENGINE: {
        win32: `docker info --format '{{.OSType}}'`,
        darwin: `cat "${process.env.HOME}/Library/Group Containers/group.com.docker/settings-store.json" | grep '"UseVirtualizationFrameworkRosetta": true' || exit 1`,
        linux: "docker ps",
    },
    SWITCH_ENGINE: (path: string) => `powershell -Command "& \\"${path}\\" -SwitchLinuxEngine"`,
    GET_CONTAINERS: `docker ps -a --format "{{.ID}}"`,
    GET_CONTAINERS_BY_NAME: `docker ps -a --format "{{.Names}}"`,
    INSPECT: (id: string) => `docker inspect ${id}`,
    START_SQL_SERVER: (
        name: string,
        password: string,
        port: number,
        version: number,
        hostname: string,
    ) =>
        `docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=${password}" -p ${port}:${defaultPortNumber} --name ${name} ${hostname ? `--hostname ${hostname}` : ""} -d mcr.microsoft.com/mssql/server:${version}-latest`,
    CHECK_CONTAINER_RUNNING: (name: string) =>
        `docker ps --filter "name=${name}" --filter "status=running" --format "{{.Names}}"`,
    VALIDATE_CONTAINER_NAME: 'docker ps -a --format "{{.Names}}"',
    START_CONTAINER: (name: string) => `docker start ${name}`,
    CHECK_LOGS: (name: string, platform: string, timestamp: string) =>
        `docker logs --since ${timestamp} ${name} | ${platform === "win32" ? 'findstr "Recovery is complete"' : 'grep "Recovery is complete"'}`,
    CHECK_CONTAINER_READY: `Recovery is complete`,
    STOP_CONTAINER: (name: string) => `docker stop ${name}`,
    DELETE_CONTAINER: (name: string) => `docker stop ${name} && docker rm ${name}`,
    INSPECT_CONTAINER: (id: string) => `docker inspect ${id}`,
    GET_SQL_SERVER_CONTAINER_VERSIONS: `curl -s https://mcr.microsoft.com/v2/mssql/server/tags/list`,
};

/**
 * The steps for the Docker container deployment process.
 */
export function initializeDockerSteps(): DockerStep[] {
    return [
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: ContainerDeployment.dockerInstallHeader,
            bodyText: ContainerDeployment.dockerInstallBody,
            errorLink: "https://docs.docker.com/engine/install/",
            errorLinkText: ContainerDeployment.installDocker,
            stepAction: checkDockerInstallation,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: ContainerDeployment.startDockerHeader,
            bodyText: ContainerDeployment.startDockerBody,
            stepAction: startDocker,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: ContainerDeployment.startDockerEngineHeader,
            bodyText: ContainerDeployment.startDockerEngineBody,
            errorLink:
                platform() === Platform.Windows && arch() === x64
                    ? "https://learn.microsoft.com/en-us/virtualization/windowscontainers/deploy-containers/set-up-linux-containers"
                    : undefined,
            errorLinkText: ContainerDeployment.configureLinuxContainers,
            stepAction: checkEngine,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: ["containerName", "password", "version", "hostname", "port"],
            headerText: ContainerDeployment.creatingContainerHeader,
            bodyText: ContainerDeployment.creatingContainerBody,
            stepAction: startSqlServerDockerContainer,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: ["containerName"],
            headerText: ContainerDeployment.settingUpContainerHeader,
            bodyText: ContainerDeployment.settingUpContainerBody,
            stepAction: checkIfContainerIsReadyForConnections,
        },
        {
            loadState: ApiStatus.NotStarted,
            argNames: [],
            headerText: ContainerDeployment.connectingToContainerHeader,
            bodyText: ContainerDeployment.connectingToContainerBody,
            stepAction: undefined,
        },
    ];
}

/**
 * Sanitizes sensitive info from error text.
 */
export function sanitizeErrorText(errorText: string): string {
    return errorText.replace(/(SA_PASSWORD=)([^ \n]+)/gi, '$1******"');
}

/**
 * Checks if the SQL Server password meets the complexity requirements.
 * If the password is valid, it returns the validation message, which is an empty string.
 * If the password is invalid, it returns an error message.
 */
export function validateSqlServerPassword(password: string): string {
    if (password.length < 8 || password.length > 128) {
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

//#region Docker Command Implementations

/**
 * Helper function to execute a command in the shell and return the output.
 */
async function execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout) => {
            if (error) return reject(error);
            resolve(stdout.trim());
        });
    });
}

/**
 * Checks if docker is installed
 */
export async function checkDockerInstallation(): Promise<DockerCommandParams> {
    try {
        await execCommand(COMMANDS.CHECK_DOCKER);
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error: ContainerDeployment.dockerInstallError,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Checks if the Docker engine is running and ready to run containers.
 * On Windows, checks if the Docker Engine is set to use Linux containers.
 * On macOS, checks if Rosetta is installed for ARM64 architecture.
 * On Linux, checks for permissions to run Docker commands.
 */
export async function checkEngine(): Promise<DockerCommandParams> {
    let dockerCliPath = "";
    if (platform() === Platform.Mac && arch() === x64) return { success: true }; // No need to check Rosetta on x64 macOS
    if (platform() !== Platform.Mac && arch() !== x64) {
        return {
            success: false,
            error: ContainerDeployment.unsupportedDockerArchitectureError(arch()),
        };
    }
    const engineCommand = COMMANDS.CHECK_ENGINE[platform()];
    if (engineCommand === undefined) {
        return {
            success: false,
            error: ContainerDeployment.unsupportedDockerPlatformError(platform()),
        };
    }

    if (platform() === Platform.Windows) {
        dockerCliPath = await getDockerPath("DockerCli.exe");
    }

    try {
        const stdout = await execCommand(engineCommand);
        if (platform() === Platform.Windows && stdout.trim() !== `'${Platform.Linux}'`) {
            const confirmation = await vscode.window.showInformationMessage(
                ContainerDeployment.switchToLinuxContainersConfirmation,
                { modal: true },
                msgYes,
            );
            if (confirmation === msgYes) {
                await execCommand(COMMANDS.SWITCH_ENGINE(dockerCliPath));
            } else {
                throw new Error(ContainerDeployment.switchToLinuxContainersCanceled);
            }
        }
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
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Checks that the provided container name is valid and unique.
 * If the name is empty, it generates a unique name based on the default container name.
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

/**
 * Finds the path to the given Docker executable.
 */
export async function getDockerPath(executable: string): Promise<string> {
    try {
        const stdout = (await execCommand(COMMANDS.GET_DOCKER_PATH)).trim();
        const fullPath = stdout.trim();

        const parts = fullPath.split(path.sep);

        // Find the second "Docker" in the path
        const dockerIndex = parts.findIndex(
            (part, idx) =>
                part.toLowerCase() === "docker" && parts.slice(0, idx).includes("Docker"),
        );

        if (dockerIndex >= 1) {
            const basePath = parts.slice(0, dockerIndex + 1).join(path.sep);
            return path.join(basePath, executable);
        }
    } catch {}
    return "";
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
    const command = COMMANDS.START_SQL_SERVER(
        containerName,
        password,
        port,
        Number(version),
        hostname,
    );
    try {
        await execCommand(command);
        dockerLogger.append(`SQL Server container ${containerName} started on port ${port}.`);
        return {
            success: true,
            port,
        };
    } catch (e) {
        return {
            success: false,
            error: ContainerDeployment.startSqlServerContainerError,
            port: undefined,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Checks if a Docker container with the specified name is running.
 * Returns true if the container is running, false otherwise.
 */
export async function isDockerContainerRunning(name: string): Promise<boolean> {
    try {
        const output = await execCommand(COMMANDS.CHECK_CONTAINER_RUNNING(name));
        const names = output.split("\n").map((line) => line.trim());
        return names.includes(name); // exact match
    } catch {
        return false;
    }
}

/**
 * Attempts to start Docker Desktop within 30 seconds.
 */
export async function startDocker(): Promise<DockerCommandParams> {
    try {
        await execCommand(COMMANDS.CHECK_DOCKER_RUNNING);
        return { success: true };
    } catch {} // If this command fails, docker is not running, so we proceed to start it.

    let dockerDesktopPath = "";
    if (platform() === Platform.Windows) {
        dockerDesktopPath = await getDockerPath("Docker Desktop.exe");
        if (!dockerDesktopPath) {
            return {
                success: false,
                error: ContainerDeployment.dockerDesktopPathError,
            };
        }
    }
    const startCommand = COMMANDS.START_DOCKER(dockerDesktopPath)[platform()];

    if (!startCommand) {
        return {
            success: false,
            error: ContainerDeployment.unsupportedDockerPlatformError(platform()),
        };
    }

    try {
        dockerLogger.appendLine("Waiting for Docker to start...");
        await execCommand(startCommand);

        let attempts = 0;
        const maxAttempts = 30;
        const interval = 2000;

        return await new Promise((resolve) => {
            const checkDocker = setInterval(async () => {
                try {
                    await execCommand(COMMANDS.CHECK_DOCKER_RUNNING);
                    clearInterval(checkDocker);
                    dockerLogger.appendLine("Docker started successfully.");
                    resolve({ success: true });
                } catch (e) {
                    if (++attempts >= maxAttempts) {
                        clearInterval(checkDocker);
                        resolve({
                            success: false,
                            error: ContainerDeployment.dockerFailedToStartWithinTimeout,
                            fullErrorText: getErrorMessage(e),
                        });
                    }
                }
            }, interval);
        });
    } catch (e) {
        return {
            success: false,
            error: ContainerDeployment.dockerFailedToStartWithinTimeout,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Restarts a Docker container with the specified name.
 * If the container is already running, it returns true without restarting.
 */
export async function restartContainer(containerName: string): Promise<boolean> {
    sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.StartContainer);

    const isContainerRunning = await isDockerContainerRunning(containerName);
    if (isContainerRunning) return true; // Container is already running
    dockerLogger.appendLine(`Restarting container: ${containerName}`);
    await execCommand(COMMANDS.START_CONTAINER(containerName));
    dockerLogger.appendLine(`Container ${containerName} restarted successfully.`);
    const containerReadyResult = await checkIfContainerIsReadyForConnections(containerName);

    if (!containerReadyResult.success) {
        return false;
    }
    return true;
}

/**
 * Checks if the provided container is ready for connections by checking the logs.
 * It waits for a maximum of 60 seconds, checking every second.
 */
export async function checkIfContainerIsReadyForConnections(
    containerName: string,
): Promise<DockerCommandParams> {
    const timeoutMs = 300_000; // 5 minutes
    const intervalMs = 1000;
    const start = Date.now();
    const startTimestamp = new Date(start).toISOString();

    dockerLogger.appendLine(`Checking if container ${containerName} is ready for connections...`);

    return new Promise((resolve) => {
        const interval = setInterval(async () => {
            try {
                const logs = await execCommand(
                    COMMANDS.CHECK_LOGS(containerName, platform(), startTimestamp),
                );
                const lines = logs.split("\n");
                const readyLine = lines.find((line) =>
                    line.includes(COMMANDS.CHECK_CONTAINER_READY),
                );

                if (readyLine) {
                    clearInterval(interval);
                    dockerLogger.appendLine(`${containerName} is ready for connections!`);
                    return resolve({ success: true });
                }
            } catch {
                // Ignore and retry
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

/**
 * Deletes a Docker container with the specified name.
 */
export async function deleteContainer(containerName: string): Promise<boolean> {
    sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.DeleteContainer);

    try {
        await execCommand(COMMANDS.DELETE_CONTAINER(containerName));
        return true;
    } catch {
        return false;
    }
}

/**
 * Stops a Docker container with the specified name.
 */
export async function stopContainer(containerName: string): Promise<boolean> {
    sendActionEvent(TelemetryViews.ContainerDeployment, TelemetryActions.StopContainer);

    try {
        await execCommand(COMMANDS.STOP_CONTAINER(containerName));
        return true;
    } catch {
        return false;
    }
}

/**
 * Retrieves the list of running Docker containers and their ports.
 * Returns a set of used ports from the specified container IDs.
 */
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

/**
 * Finds a Docker container by checking if its exposed ports match the server name.
 * It inspects each container to find a match with the server name.
 */
async function findContainerByPort(containerIds: string[], serverName: string): Promise<string> {
    if (serverName === localhost || serverName === localhostIP) {
        serverName += `,${defaultPortNumber}`;
    }
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

    return undefined;
}

/**
 * Checks if a connection is a Docker container by inspecting the server name.
 */
export async function checkIfConnectionIsDockerContainer(serverName: string): Promise<string> {
    if (!serverName.includes(localhost) && !serverName.includes(localhostIP)) return "";

    try {
        const stdout = await execCommand(COMMANDS.GET_CONTAINERS);
        const containerIds = stdout.split("\n").filter(Boolean);
        if (!containerIds.length) return undefined;

        return await findContainerByPort(containerIds, serverName);
    } catch {
        return undefined;
    }
}

/**
 * Finds an available port for a new Docker container, starting from the specified port.
 * It checks the currently running containers and their exposed ports to find an unused port.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
    try {
        const stdout = await execCommand(COMMANDS.GET_CONTAINERS);
        const containerIds = stdout.split("\n").filter(Boolean);
        if (!containerIds.length) return startPort;

        const usedPorts = await getUsedPortsFromContainers(containerIds);

        for (let port = startPort; port <= MAX_PORT_NUMBER; port++) {
            if (!usedPorts.has(port)) {
                return port;
            }
        }
        return -1; // No available port found
    } catch {
        return -1;
    }
}

/**
 * Retrieves the SQL Server container versions from the Microsoft Container Registry.
 */
export async function getSqlServerContainerVersions(): Promise<FormItemOptions[]> {
    try {
        const stdout = await execCommand(COMMANDS.GET_SQL_SERVER_CONTAINER_VERSIONS);
        const versions = stdout.split("\n");
        const uniqueYears = Array.from(
            new Set(
                versions
                    .map(
                        (v) =>
                            v
                                .trim() // trim whitespace
                                .replace(/^"|"[,]*$/g, "") //remove starting and ending quotes and trailing commas
                                .slice(0, 4), // take first 4 chars
                    )
                    .filter((v) => /^\d{4}$/.test(v)), // ensure all digits
            ),
        ).reverse();

        return uniqueYears.map((year) => ({
            displayName: ContainerDeployment.sqlServerVersionImage(year),
            value: year,
        })) as FormItemOptions[];
    } catch (e) {
        dockerLogger.appendLine(
            `Error fetching SQL Server container versions: ${getErrorMessage(e)}`,
        );
        return [];
    }
}
/**
 * Prepares the given Docker container for command execution.
 * This function checks if Docker is running and if the specified container exists.
 */
export async function prepareForDockerContainerCommand(
    containerName: string,
): Promise<DockerCommandParams> {
    const startDockerResult = await startDocker();
    if (!startDockerResult.success) return startDockerResult;

    const containerExists = await checkContainerExists(containerName);

    if (!containerExists) {
        return {
            success: false,
            error: ContainerDeployment.containerDoesNotExistError,
        };
    }
    return {
        success: true,
    };
}

/**
 * Checks if a Docker container with the specified name exists.
 */
export async function checkContainerExists(name: string): Promise<boolean> {
    try {
        const stdout = await execCommand(COMMANDS.GET_CONTAINERS_BY_NAME);
        const containers = stdout.split("\n").map((c) => c.trim());
        return containers.includes(name);
    } catch (e) {
        dockerLogger.appendLine(`Error checking if container exists: ${getErrorMessage(e)}`);
        return false;
    }
}

//#endregion
