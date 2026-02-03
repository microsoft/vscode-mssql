/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { arch, platform } from "os";
import fixPath from "fix-path";
import { DockerCommandParams, DockerStep } from "../sharedInterfaces/localContainers";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    defaultContainerName,
    defaultPortNumber,
    docker,
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
import { Dab } from "../sharedInterfaces/dab";

/**
 * The maximum port number that can be used for Docker containers.
 */
const MAX_PORT_NUMBER = 65535;

/**
 * The length of the year string in the version number
 */
const yearStringLength = 4;

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

/**
 * Commands used to interact with Docker.
 * These return structured command objects.
 */
export const COMMANDS = {
    CHECK_DOCKER: (): DockerCommand => ({
        command: "docker",
        args: ["--version"],
    }),
    CHECK_DOCKER_RUNNING: (): DockerCommand => ({
        command: "docker",
        args: ["info"],
    }),
    GET_DOCKER_PATH: (): DockerCommand => ({
        command: "powershell.exe",
        args: ["-Command", "(Get-Command docker).Source"],
    }),
    START_DOCKER: (path: string) => ({
        win32: {
            command: "cmd.exe",
            args: ["/c", "start", "", path],
        },
        darwin: {
            command: "open",
            args: ["-a", "Docker"],
        },
        linux: {
            command: "systemctl",
            args: ["start", "docker"],
        },
    }),
    CHECK_ENGINE: {
        win32: {
            command: "docker",
            args: ["info", "--format", "{{.OSType}}"],
        },
        darwin: {
            dockerCmd: {
                command: "cat",
                args: [
                    `${process.env.HOME}/Library/Group Containers/group.com.docker/settings-store.json`,
                ],
            },
            grepCmd: {
                command: "grep",
                args: ['"UseVirtualizationFrameworkRosetta": true'],
            },
        },
        linux: {
            command: "docker",
            args: ["ps"],
        },
    },
    SWITCH_ENGINE: (path: string): DockerCommand => ({
        command: "powershell.exe",
        args: ["-Command", `& "${path}" -SwitchLinuxEngine`],
    }),
    GET_CONTAINERS: (): DockerCommand => ({
        command: "docker",
        args: ["ps", "-a", "--format", "{{.ID}}"],
    }),
    GET_CONTAINERS_BY_NAME: (): DockerCommand => ({
        command: "docker",
        args: ["ps", "-a", "--format", "{{.Names}}"],
    }),
    GET_CONTAINER_NAME_FROM_ID: (containerId: string): DockerCommand => ({
        command: "docker",
        args: ["ps", "-a", "--filter", `id=${containerId}`, "--format", "{{.Names}}"],
    }),
    INSPECT: (id: string): DockerCommand => ({
        command: "docker",
        args: ["inspect", sanitizeContainerInput(id)],
    }),
    PULL_IMAGE: (versionTag: string): DockerCommand => ({
        command: "docker",
        args: ["pull", `mcr.microsoft.com/mssql/server:${versionTag}`],
    }),
    START_SQL_SERVER: (
        name: string,
        password: string,
        port: number,
        versionTag: string,
        hostname: string,
    ): DockerCommand => {
        const args = [
            "run",
            "-e",
            "ACCEPT_EULA=Y",
            "-e",
            `\'SA_PASSWORD=${password}\'`,
            "-p",
            `\'${port}:${defaultPortNumber}\'`,
            "--name",
            `\'${sanitizeContainerInput(name)}\'`,
        ];

        if (hostname) {
            args.push("--hostname", sanitizeContainerInput(hostname));
        }

        args.push("-d", `mcr.microsoft.com/mssql/server:${versionTag}`);

        return { command: "docker", args };
    },
    CHECK_CONTAINER_RUNNING: (name: string): DockerCommand => ({
        command: "docker",
        args: [
            "ps",
            "--filter",
            `name=${sanitizeContainerInput(name)}`,
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ],
    }),
    VALIDATE_CONTAINER_NAME: (): DockerCommand => ({
        command: "docker",
        args: ["ps", "-a", "--format", "{{.Names}}"],
    }),
    START_CONTAINER: (name: string): DockerCommand => ({
        command: "docker",
        args: ["start", sanitizeContainerInput(name)],
    }),
    CHECK_LOGS: (
        name: string,
        timestamp: string,
    ): {
        dockerCmd: DockerCommand;
        grepCmd: DockerCommand;
    } => ({
        dockerCmd: {
            command: "docker",
            args: ["logs", "--since", timestamp, sanitizeContainerInput(name)],
        },
        grepCmd: {
            command: platform() === "win32" ? "findstr" : "grep",
            args: ["Recovery is complete"],
        },
    }),
    CHECK_CONTAINER_READY: `Recovery is complete`,
    STOP_CONTAINER: (name: string): DockerCommand => ({
        command: "docker",
        args: ["stop", sanitizeContainerInput(name)],
    }),
    DELETE_CONTAINER: (
        name: string,
    ): {
        stop: DockerCommand;
        remove: DockerCommand;
    } => ({
        stop: {
            command: "docker",
            args: ["stop", sanitizeContainerInput(name)],
        },
        remove: {
            command: "docker",
            args: ["rm", sanitizeContainerInput(name)],
        },
    }),
    INSPECT_CONTAINER: (id: string): DockerCommand => ({
        command: "docker",
        args: ["inspect", sanitizeContainerInput(id)],
    }),
    GET_SQL_SERVER_CONTAINER_VERSIONS: (): DockerCommand => ({
        command: "curl",
        args: ["-s", "https://mcr.microsoft.com/v2/mssql/server/tags/list"],
    }),
    // DAB (Data API Builder) specific commands
    PULL_DAB_IMAGE: (imageTag: string): DockerCommand => ({
        command: "docker",
        args: ["pull", imageTag],
    }),
    START_DAB_CONTAINER: (
        name: string,
        port: number,
        configFilePath: string,
        imageTag: string,
        internalPort: number,
    ): DockerCommand => ({
        command: "docker",
        args: [
            "run",
            "-d",
            "--name",
            sanitizeContainerInput(name),
            "-p",
            `${port}:${internalPort}`,
            "-v",
            `${configFilePath}:/App/dab-config.json:ro`,
            imageTag,
            "--ConfigFileName",
            "/App/dab-config.json",
        ],
    }),
    CHECK_DAB_HEALTH: (port: number): DockerCommand => ({
        command: "curl",
        args: ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://localhost:${port}/`],
    }),
};

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
 * @returns The link to the Docker engine error documentation based on the platform and architecture.
 */
export function getEngineErrorLink() {
    if (platform() === Platform.Windows && arch() === x64) {
        return windowsContainersErrorLink;
    } else if (platform() === Platform.Mac && arch() !== x64) {
        return rosettaErrorLink;
    }
    return undefined;
}

/**
 * Gets the text to the Docker engine error documentation based on the platform and architecture.
 * @returns The text to the Docker engine error documentation based on the platform and architecture.
 */
export function getEngineErrorLinkText() {
    if (platform() === Platform.Windows && arch() === x64) {
        return LocalContainers.configureLinuxContainers;
    } else if (platform() === Platform.Mac && arch() !== x64) {
        return LocalContainers.configureRosetta;
    }
    return undefined;
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
 * Sanitizes container input by removing any characters that aren't alphanumeric, underscore, dot, or hyphen.
 */
export function sanitizeContainerInput(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.-]/g, "");
}

//#region Docker Command Implementations

/**
 * Interface for parameterized commands
 */
interface DockerCommand {
    command: string;
    args: string[];
}

/**
 * Safe command execution helper that uses spawn
 */
async function execDockerCommand(cmd: DockerCommand): Promise<string> {
    // Ensure PATH is fixed for macOS/Linux environments; sometimes when launched from VS Code,
    // PATH can inherited incorrectly ie. GUI apps on macOS
    // and Linux do not inherit the $PATH defined in your dotfiles
    fixPath();

    return new Promise((resolve, reject) => {
        const process = spawn(cmd.command, cmd.args, {
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        process.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        process.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        process.on("close", (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                const error = new Error(stderr || `Command failed with exit code ${code}`);
                (error as any).code = code;
                reject(error);
            }
        });

        process.on("error", (error) => {
            reject(error);
        });
    });
}

/**
 * Safe command execution for commands with pipes (using spawn)
 */
async function execDockerCommandWithPipe(
    dockerCmd: DockerCommand,
    pipeCmd: DockerCommand,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const dockerProcess = spawn(dockerCmd.command, dockerCmd.args);
        const pipeProcess = spawn(pipeCmd.command, pipeCmd.args);

        let output = "";
        let errorOutput = "";

        // Pipe docker output to grep/findstr
        dockerProcess.stdout.pipe(pipeProcess.stdin);

        pipeProcess.stdout.on("data", (data) => {
            output += data.toString();
        });

        dockerProcess.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });

        pipeProcess.on("close", (code) => {
            if (code === 0 || code === 1) {
                // grep returns 1 when no matches found
                resolve(output.trim());
            } else {
                reject(new Error(errorOutput || `Command failed with code ${code}`));
            }
        });

        dockerProcess.on("error", reject);
        pipeProcess.on("error", reject);
    });
}

/**
 * Checks if docker is installed
 */
export async function checkDockerInstallation(): Promise<DockerCommandParams> {
    try {
        await execDockerCommand(COMMANDS.CHECK_DOCKER());
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
 * On macOS, checks if Rosetta is installed for ARM64 architecture.
 * On Linux, checks for permissions to run Docker commands.
 */
export async function checkEngine(): Promise<DockerCommandParams> {
    let dockerCliPath = "";
    if (platform() === Platform.Mac && arch() === x64) return { success: true }; // No need to check Rosetta on x64 macOS
    if (platform() !== Platform.Mac && arch() !== x64) {
        return {
            success: false,
            error: LocalContainers.unsupportedDockerArchitectureError(arch()),
        };
    }
    const engineCommand = COMMANDS.CHECK_ENGINE[platform()];
    if (engineCommand === undefined) {
        return {
            success: false,
            error: LocalContainers.unsupportedDockerPlatformError(platform()),
        };
    }

    if (platform() === Platform.Windows) {
        dockerCliPath = await getDockerPath("DockerCli.exe");
    }

    try {
        let stdout = "";
        if (platform() === Platform.Windows) {
            stdout = await execDockerCommand(engineCommand);
        } else if (platform() === Platform.Mac) {
            // For macOS, we need to use pipe commands to check Rosetta
            stdout = await execDockerCommandWithPipe(
                engineCommand.dockerCmd,
                engineCommand.grepCmd,
            );
        } else {
            // Linux
            stdout = await execDockerCommand(engineCommand);
        }

        if (platform() === Platform.Windows && stdout.trim() !== `${Platform.Linux}`) {
            const confirmation = await vscode.window.showInformationMessage(
                LocalContainers.switchToLinuxContainersConfirmation,
                { modal: true },
                msgYes,
            );
            if (confirmation === msgYes) {
                await execDockerCommand(COMMANDS.SWITCH_ENGINE(dockerCliPath));
            } else {
                throw new Error(LocalContainers.switchToLinuxContainersCanceled);
            }
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

/**
 * Checks that the provided container name is valid and unique.
 * If the name is empty, it generates a unique name based on the default container name.
 */
export async function validateContainerName(containerName: string): Promise<string> {
    try {
        const stdout = await execDockerCommand(COMMANDS.VALIDATE_CONTAINER_NAME());
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
        const stdout = await execDockerCommand(COMMANDS.GET_DOCKER_PATH());
        const fullPath = stdout.trim();

        const parts = fullPath.split(path.sep);

        // Find the second "Docker" in the path
        const dockerIndex = parts.findIndex(
            (part, idx) =>
                part.toLowerCase() === docker &&
                parts.slice(0, idx).some((p) => p.toLowerCase() === docker),
        );

        if (dockerIndex >= 1) {
            const basePath = parts.slice(0, dockerIndex + 1).join(path.sep);
            return path.join(basePath, executable);
        }
    } catch {}
    return "";
}

/**
 * Temp fix for the SQL Server 2025 version issue on Mac.
 * Returns the last working version of SQL Server 2025 for Mac.
 */
export function constructVersionTag(version: string): string {
    let versionYear = version.substring(0, yearStringLength);
    return `${versionYear}-latest`;
}

/**
 * Pulls the SQL Server container image for the specified version.
 */
export async function pullSqlServerContainerImage(version: string): Promise<DockerCommandParams> {
    try {
        await execDockerCommand(COMMANDS.PULL_IMAGE(constructVersionTag(version)));
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
        await execDockerCommand(
            COMMANDS.START_SQL_SERVER(
                containerName,
                password,
                port,
                constructVersionTag(version),
                hostname,
            ),
        );
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
 * Checks if a Docker container with the specified name is running.
 * Returns true if the container is running, false otherwise.
 */
export async function isDockerContainerRunning(name: string): Promise<boolean> {
    try {
        const output = await execDockerCommand(COMMANDS.CHECK_CONTAINER_RUNNING(name));
        const names = output.split("\n").map((line) => line.trim());
        return names.includes(name); // exact match
    } catch {
        return false;
    }
}

/**
 * Attempts to start Docker Desktop within 30 seconds.
 */
export async function startDocker(
    node?: ConnectionNode,
    objectExplorerService?: ObjectExplorerService,
): Promise<DockerCommandParams> {
    try {
        await execDockerCommand(COMMANDS.CHECK_DOCKER_RUNNING());
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.StartDocker, {
            dockerStartedThroughExtension: "false",
        });
        return { success: true };
    } catch {} // If this command fails, docker is not running, so we proceed to start it.
    if (node && objectExplorerService) {
        node.loadingLabel = LocalContainers.startingDockerLoadingLabel;
        await objectExplorerService.setLoadingUiForNode(node);
    }
    let dockerDesktopPath = "";
    if (platform() === Platform.Windows) {
        dockerDesktopPath = await getDockerPath(windowsDockerDesktopExecutable);
        if (!dockerDesktopPath) {
            return {
                success: false,
                error: LocalContainers.dockerDesktopPathError,
            };
        }
    }
    const startCommands = COMMANDS.START_DOCKER(dockerDesktopPath);
    const startCommand = startCommands[platform()];

    if (!startCommand) {
        return {
            success: false,
            error: LocalContainers.unsupportedDockerPlatformError(platform()),
        };
    }

    try {
        dockerLogger.appendLine("Waiting for Docker to start...");
        await execDockerCommand(startCommand);

        let attempts = 0;
        const maxAttempts = 30;
        const interval = 2000;

        return await new Promise((resolve) => {
            const checkDocker = setInterval(async () => {
                try {
                    await execDockerCommand(COMMANDS.CHECK_DOCKER_RUNNING());
                    clearInterval(checkDocker);
                    dockerLogger.appendLine("Docker started successfully.");
                    sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.StartDocker, {
                        dockerStartedThroughExtension: "true",
                    });
                    resolve({ success: true });
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
            }, interval);
        });
    } catch (e) {
        return {
            success: false,
            error: LocalContainers.dockerFailedToStartWithinTimeout,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Restarts a Docker container with the specified name.
 * If the container is already running, it returns true without restarting.
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
    await execDockerCommand(COMMANDS.START_CONTAINER(containerName));

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
                const { dockerCmd, grepCmd } = COMMANDS.CHECK_LOGS(containerName, startTimestamp);
                const logs = await execDockerCommandWithPipe(dockerCmd, grepCmd);
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
                    error: LocalContainers.containerFailedToStartWithinTimeout,
                });
            }
        }, intervalMs);
    });
}

/**
 * Deletes a Docker container with the specified name.
 */
export async function deleteContainer(containerName: string): Promise<boolean> {
    try {
        const { stop, remove } = COMMANDS.DELETE_CONTAINER(containerName);
        try {
            await execDockerCommand(stop);
        } catch {
            // Container might already be stopped
        }
        await execDockerCommand(remove);
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.DeleteContainer);
        return true;
    } catch (e) {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.DeleteContainer,
            e,
            false, // includeErrorMessage
            undefined, // errorCode
            undefined, // errorType
        );
        return false;
    }
}

/**
 * Stops a Docker container with the specified name.
 */
export async function stopContainer(containerName: string): Promise<boolean> {
    try {
        await execDockerCommand(COMMANDS.STOP_CONTAINER(containerName));
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.StopContainer);
        return true;
    } catch (e) {
        sendErrorEvent(
            TelemetryViews.LocalContainers,
            TelemetryActions.StopContainer,
            e,
            false, // includeErrorMessage
            undefined, // errorCode
            undefined, // errorType
        );
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
                const inspect = await execDockerCommand(COMMANDS.INSPECT_CONTAINER(id));
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
 * Determines whether a connection is running inside a Docker container.
 *
 * Inspects the `machineName` from the connection's server info. For Docker connections,
 * the machine name is set to the UUID corresponding to the container's ID.
 *
 * @param machineName The machine name hosting the connection, as reported in its server info.
 */
export async function checkIfConnectionIsDockerContainer(machineName: string): Promise<string> {
    try {
        const stdout = await execDockerCommand(COMMANDS.GET_CONTAINER_NAME_FROM_ID(machineName));
        return stdout.trim();
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
        const stdout = await execDockerCommand(COMMANDS.GET_CONTAINERS());
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
 * Retrieves all raw SQL Server container tags from the Microsoft Container Registry.
 * @returns the complete list of available tags without filtering or processing.
 */
export async function getAllSqlServerContainerTags(): Promise<string[]> {
    try {
        const stdout = await execDockerCommand(COMMANDS.GET_SQL_SERVER_CONTAINER_VERSIONS());
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

        versionOptions[0].value = latestImage; // Version options is guaranteed to have at least one element

        return versionOptions;
    } catch (e) {
        dockerLogger.appendLine(
            `Error parsing SQL Server container versions: ${getErrorMessage(e)}`,
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
    containerNode: ConnectionNode,
    objectExplorerService: ObjectExplorerService,
): Promise<DockerCommandParams> {
    const startDockerResult = await startDocker(containerNode, objectExplorerService);
    if (!startDockerResult.success) {
        vscode.window.showErrorMessage(startDockerResult.error);
        return startDockerResult;
    }

    const containerExists = await checkContainerExists(containerName);

    if (!containerExists) {
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
    return {
        success: true,
    };
}

/**
 * Checks if a Docker container with the specified name exists.
 */
export async function checkContainerExists(name: string): Promise<boolean> {
    try {
        const stdout = await execDockerCommand(COMMANDS.GET_CONTAINERS_BY_NAME());
        const containers = stdout.split("\n").map((c) => c.trim());
        return containers.includes(name);
    } catch (e) {
        dockerLogger.appendLine(`Error checking if container exists: ${getErrorMessage(e)}`);
        return false;
    }
}

//#endregion

//#region DAB (Data API Builder) Docker Functions

/**
 * Pulls the DAB container image from MCR
 */
export async function pullDabContainerImage(): Promise<DockerCommandParams> {
    try {
        dockerLogger.appendLine(`Pulling DAB container image: ${Dab.DAB_CONTAINER_IMAGE}`);
        await execDockerCommand(COMMANDS.PULL_DAB_IMAGE(Dab.DAB_CONTAINER_IMAGE));
        dockerLogger.appendLine("DAB container image pulled successfully.");
        return { success: true };
    } catch (e) {
        dockerLogger.appendLine(`Failed to pull DAB container image: ${getErrorMessage(e)}`);
        return {
            success: false,
            error: "Failed to pull DAB container image. Please check your network connection.",
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Writes the DAB config content to a temporary file
 * @param configContent The DAB configuration JSON content
 * @returns The path to the temporary config file
 */
export function writeDabConfigToTempFile(configContent: string): string {
    const tempDir = os.tmpdir();
    const configFileName = `dab-config-${Date.now()}.json`;
    const configFilePath = path.join(tempDir, configFileName);

    fs.writeFileSync(configFilePath, configContent, "utf8");
    dockerLogger.appendLine(`DAB config written to: ${configFilePath}`);

    return configFilePath;
}

/**
 * Cleans up a temporary DAB config file
 * @param configFilePath Path to the config file to delete
 */
export function cleanupDabConfigFile(configFilePath: string): void {
    try {
        if (fs.existsSync(configFilePath)) {
            fs.unlinkSync(configFilePath);
            dockerLogger.appendLine(`Cleaned up DAB config file: ${configFilePath}`);
        }
    } catch (e) {
        dockerLogger.appendLine(`Failed to cleanup DAB config file: ${getErrorMessage(e)}`);
    }
}

/**
 * Starts a DAB Docker container with the specified parameters
 * @param containerName Name for the container
 * @param port Port to expose the DAB API on
 * @param configFilePath Path to the DAB config file
 */
export async function startDabDockerContainer(
    containerName: string,
    port: number,
    configFilePath: string,
): Promise<DockerCommandParams> {
    try {
        dockerLogger.appendLine(
            `Starting DAB container: ${containerName} on port ${port} with config ${configFilePath}`,
        );

        await execDockerCommand(
            COMMANDS.START_DAB_CONTAINER(
                containerName,
                port,
                configFilePath,
                Dab.DAB_CONTAINER_IMAGE,
                Dab.DAB_DEFAULT_PORT,
            ),
        );

        dockerLogger.appendLine(`DAB container ${containerName} started successfully.`);
        return {
            success: true,
            port,
        };
    } catch (e) {
        dockerLogger.appendLine(`Failed to start DAB container: ${getErrorMessage(e)}`);
        return {
            success: false,
            error: "Failed to start DAB container. Please check the Docker logs for details.",
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Checks if the DAB container is ready to accept connections
 * Polls the health endpoint until it responds or times out
 * @param containerName Name of the container (for logging)
 * @param port Port the DAB API is exposed on
 */
export async function checkIfDabContainerIsReady(
    containerName: string,
    port: number,
): Promise<DockerCommandParams> {
    const timeoutMs = 60_000; // 1 minute timeout for DAB
    const intervalMs = 1000;
    const start = Date.now();

    dockerLogger.appendLine(
        `Checking if DAB container ${containerName} is ready on port ${port}...`,
    );

    return new Promise((resolve) => {
        const interval = setInterval(async () => {
            try {
                const response = await execDockerCommand(COMMANDS.CHECK_DAB_HEALTH(port));
                const statusCode = parseInt(response, 10);

                // DAB returns various status codes, but any response means it's running
                if (statusCode >= 200 && statusCode < 500) {
                    clearInterval(interval);
                    dockerLogger.appendLine(
                        `DAB container ${containerName} is ready! (HTTP ${statusCode})`,
                    );
                    return resolve({ success: true, port });
                }
            } catch {
                // Ignore errors and retry - container may not be ready yet
            }

            if (Date.now() - start > timeoutMs) {
                clearInterval(interval);
                // Try to get container logs for debugging
                try {
                    const { dockerCmd } = COMMANDS.CHECK_LOGS(containerName, "0");
                    const logs = await execDockerCommand(dockerCmd);
                    dockerLogger.appendLine(`DAB container logs:\n${logs}`);
                } catch {
                    // Ignore log retrieval errors
                }
                return resolve({
                    success: false,
                    error: "DAB container failed to become ready within the timeout period.",
                });
            }
        }, intervalMs);
    });
}

/**
 * Stops and removes a DAB container
 * @param containerName Name of the container to stop and remove
 */
export async function stopAndRemoveDabContainer(
    containerName: string,
): Promise<DockerCommandParams> {
    try {
        dockerLogger.appendLine(`Stopping DAB container: ${containerName}`);
        try {
            await execDockerCommand(COMMANDS.STOP_CONTAINER(containerName));
        } catch {
            // Container might already be stopped
        }

        dockerLogger.appendLine(`Removing DAB container: ${containerName}`);
        await execDockerCommand(COMMANDS.DELETE_CONTAINER(containerName).remove);

        dockerLogger.appendLine(`DAB container ${containerName} stopped and removed.`);
        return { success: true };
    } catch (e) {
        dockerLogger.appendLine(`Failed to stop/remove DAB container: ${getErrorMessage(e)}`);
        return {
            success: false,
            error: "Failed to stop and remove DAB container.",
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Validates and returns a unique container name for DAB
 * @param containerName The requested container name (can be empty for auto-generation)
 */
export async function validateDabContainerName(containerName: string): Promise<string> {
    const nameToValidate =
        containerName.trim() === "" ? Dab.DAB_DEFAULT_CONTAINER_NAME : containerName;
    return validateContainerName(nameToValidate);
}

/**
 * Finds an available port for the DAB container
 * @param preferredPort The preferred port to use if available
 */
export async function findAvailableDabPort(
    preferredPort: number = Dab.DAB_DEFAULT_PORT,
): Promise<number> {
    return findAvailablePort(preferredPort);
}

/**
 * Runs a specific DAB deployment step
 * Reuses the common Docker prerequisite steps (install, start, engine check)
 * and adds DAB-specific steps for image pull, container start, and readiness check
 *
 * @param step The step to run
 * @param params Optional parameters needed for certain steps
 * @param configContent Optional DAB config content (needed for startContainer step)
 */
export async function runDabDeploymentStep(
    step: Dab.DabDeploymentStepOrder,
    params?: Dab.DabDeploymentParams,
    configContent?: string,
): Promise<Dab.RunDeploymentStepResponse> {
    switch (step) {
        case Dab.DabDeploymentStepOrder.dockerInstallation:
            return checkDockerInstallation();

        case Dab.DabDeploymentStepOrder.startDockerDesktop:
            return startDocker();

        case Dab.DabDeploymentStepOrder.checkDockerEngine:
            return checkEngine();

        case Dab.DabDeploymentStepOrder.pullImage:
            return pullDabContainerImage();

        case Dab.DabDeploymentStepOrder.startContainer: {
            if (!params || !configContent) {
                return {
                    success: false,
                    error: "Container name, port, and config content are required to start the container.",
                };
            }

            // Write config to temp file
            const configFilePath = writeDabConfigToTempFile(configContent);

            try {
                const result = await startDabDockerContainer(
                    params.containerName,
                    params.port,
                    configFilePath,
                );

                if (result.success) {
                    return {
                        success: true,
                        apiUrl: `http://localhost:${params.port}`,
                    };
                }

                // Clean up config file on failure
                cleanupDabConfigFile(configFilePath);
                return result;
            } catch (e) {
                cleanupDabConfigFile(configFilePath);
                return {
                    success: false,
                    error: "Failed to start DAB container.",
                    fullErrorText: getErrorMessage(e),
                };
            }
        }

        case Dab.DabDeploymentStepOrder.checkContainer: {
            if (!params) {
                return {
                    success: false,
                    error: "Container name and port are required to check container readiness.",
                };
            }

            const result = await checkIfDabContainerIsReady(params.containerName, params.port);
            if (result.success) {
                return {
                    success: true,
                    apiUrl: `http://localhost:${params.port}`,
                };
            }
            return result;
        }

        default:
            return {
                success: false,
                error: `Unknown deployment step: ${step}`,
            };
    }
}

//#endregion
