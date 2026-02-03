/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { spawn } from "child_process";
import { arch, platform } from "os";
import { PassThrough } from "stream";
import { DockerCommandParams, DockerStep } from "../sharedInterfaces/localContainers";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    defaultContainerName,
    defaultPortNumber,
    docker,
    dockerDeploymentLoggerChannelName,
    MAX_PORT_NUMBER,
    sqlServerDockerRegistry,
    sqlServerDockerRepository,
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
import * as path from "path";
import { FormItemOptions, FormItemValidationState } from "../sharedInterfaces/form";
import { getErrorMessage } from "../utils/utils";
import { Logger } from "../models/logger";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";
import fixPath from "fix-path";
import type Dockerode from "dockerode";
import { getDockerodeClient } from "../docker/dockerodeClient";

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
    CHECK_CONTAINER_READY: `Recovery is complete`,
    GET_SQL_SERVER_CONTAINER_VERSIONS: (): DockerCommand => ({
        command: "curl",
        args: ["-s", "https://mcr.microsoft.com/v2/mssql/server/tags/list"],
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

function getSqlServerImageName(versionTag: string): string {
    return `${sqlServerDockerRegistry}/${sqlServerDockerRepository}:${versionTag}`;
}

async function getContainerByName(name: string): Promise<Dockerode.Container | undefined> {
    const safeContainerName = sanitizeContainerInput(name);
    const dockerClient = getDockerodeClient();
    const filters = {
        name: [`^/${safeContainerName}$`],
    };
    const containerInfos = await dockerClient.listContainers({
        all: true,
        filters,
    });
    const matchedContainer = containerInfos[0];
    if (!matchedContainer?.Id) {
        return undefined;
    }

    return dockerClient.getContainer(matchedContainer.Id);
}

function getContainerHostPorts(containerInspectInfo: Dockerode.ContainerInspectInfo): Set<number> {
    const usedPorts = new Set<number>();
    const networkPortBindings = containerInspectInfo.NetworkSettings?.Ports ?? {};
    const hostConfigPortBindings = (containerInspectInfo.HostConfig?.PortBindings ?? {}) as Record<
        string,
        unknown
    >;

    const addBoundHostPorts = (portBindings: Record<string, unknown>) => {
        for (const bindingEntries of Object.values(portBindings)) {
            if (!Array.isArray(bindingEntries)) {
                continue;
            }

            for (const binding of bindingEntries) {
                const hostPortValue = (binding as { HostPort?: string }).HostPort;
                const hostPort = Number.parseInt(hostPortValue ?? "", 10);
                if (!Number.isNaN(hostPort)) {
                    usedPorts.add(hostPort);
                }
            }
        }
    };

    // Running containers usually expose mappings via NetworkSettings.Ports.
    addBoundHostPorts(networkPortBindings as Record<string, unknown>);
    // Stopped containers can still reserve explicit mappings in HostConfig.PortBindings.
    addBoundHostPorts(hostConfigPortBindings);

    return usedPorts;
}

async function waitForContainerReadyFromLogs(
    container: Dockerode.Container,
    sinceTimestampSeconds: number,
    timeoutMs: number,
    readyMessage: string,
): Promise<boolean> {
    const dockerClient = getDockerodeClient();
    const rawLogsStream = (await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        since: sinceTimestampSeconds,
    })) as NodeJS.ReadableStream;
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    dockerClient.modem.demuxStream(rawLogsStream, stdoutStream, stderrStream);

    return new Promise<boolean>((resolve, reject) => {
        let chunkBuffer = "";
        const maxBufferLength = readyMessage.length * 2;

        const cleanupAndResolve = (result: boolean) => {
            clearTimeout(timeoutHandle);
            stdoutStream.removeListener("data", onData);
            stderrStream.removeListener("data", onData);
            rawLogsStream.removeListener("error", onError);
            rawLogsStream.removeListener("end", onEnd);
            rawLogsStream.removeListener("close", onEnd);
            const destroyLogStream = (
                rawLogsStream as NodeJS.ReadableStream & {
                    destroy?: () => void;
                }
            ).destroy;
            destroyLogStream?.call(rawLogsStream);
            resolve(result);
        };

        const onData = (chunk: Buffer | string) => {
            chunkBuffer += chunk.toString();
            if (chunkBuffer.includes(readyMessage)) {
                cleanupAndResolve(true);
                return;
            }

            if (chunkBuffer.length > maxBufferLength) {
                chunkBuffer = chunkBuffer.slice(-maxBufferLength);
            }
        };

        const onError = (error: Error) => {
            clearTimeout(timeoutHandle);
            reject(error);
        };

        const onEnd = () => cleanupAndResolve(false);

        const timeoutHandle = setTimeout(() => cleanupAndResolve(false), timeoutMs);

        stdoutStream.on("data", onData);
        stderrStream.on("data", onData);
        rawLogsStream.on("error", onError);
        rawLogsStream.on("end", onEnd);
        rawLogsStream.on("close", onEnd);
    });
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
        const dockerClient = getDockerodeClient();
        const containerInfos = await dockerClient.listContainers({ all: true });
        const existingContainers = containerInfos
            .flatMap((containerInfo) => containerInfo.Names ?? [])
            .map((name) => name.replace(/^\//, ""));
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
        const dockerClient = getDockerodeClient();
        const imageTag = constructVersionTag(version);
        const imageName = getSqlServerImageName(imageTag);
        const pullStream = await dockerClient.pull(imageName);
        await new Promise<void>((resolve, reject) => {
            dockerClient.modem.followProgress(pullStream, (error) =>
                error ? reject(error) : resolve(),
            );
        });
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
 * Checks if a Docker container with the specified name is running.
 * Returns true if the container is running, false otherwise.
 */
export async function isDockerContainerRunning(name: string): Promise<boolean> {
    try {
        const container = await getContainerByName(name);
        if (!container) {
            return false;
        }

        const containerInfo = await container.inspect();
        return containerInfo.State?.Running ?? false;
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
    const container = await getContainerByName(containerName);
    if (!container) {
        throw new Error(`Container ${containerName} does not exist.`);
    }
    await container.start();

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
 * It waits up to 5 minutes while streaming log chunks.
 */
export async function checkIfContainerIsReadyForConnections(
    containerName: string,
): Promise<DockerCommandParams> {
    const timeoutMs = 300_000; // 5 minutes
    const readyMessage = COMMANDS.CHECK_CONTAINER_READY;
    const startTimestampSeconds = Math.floor(Date.now() / 1000);

    dockerLogger.appendLine(`Checking if container ${containerName} is ready for connections...`);

    try {
        const container = await getContainerByName(containerName);
        if (!container) {
            return {
                success: false,
                error: LocalContainers.containerFailedToStartWithinTimeout,
            };
        }

        const isReady = await waitForContainerReadyFromLogs(
            container,
            startTimestampSeconds,
            timeoutMs,
            readyMessage,
        );
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
 * Deletes a Docker container with the specified name.
 */
export async function deleteContainer(containerName: string): Promise<boolean> {
    try {
        const container = await getContainerByName(containerName);
        if (!container) {
            throw new Error(`Container ${containerName} does not exist.`);
        }

        try {
            await container.stop();
        } catch {
            // Container might already be stopped
        }
        await container.remove();
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
        const container = await getContainerByName(containerName);
        if (!container) {
            throw new Error(`Container ${containerName} does not exist.`);
        }

        await container.stop();
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
    const dockerClient = getDockerodeClient();

    await Promise.all(
        containerIds.map(async (id) => {
            try {
                const container = dockerClient.getContainer(sanitizeContainerInput(id));
                const inspectInfo = await container.inspect();
                getContainerHostPorts(inspectInfo).forEach((port) => usedPorts.add(port));
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
        const dockerClient = getDockerodeClient();
        const container = dockerClient.getContainer(sanitizeContainerInput(machineName));
        const inspectInfo = await container.inspect();
        return inspectInfo.Name?.replace(/^\//, "");
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
        const dockerClient = getDockerodeClient();
        const containerInfos = await dockerClient.listContainers({ all: true });
        const containerIds = containerInfos
            .map((containerInfo) => containerInfo.Id)
            .filter((id): id is string => Boolean(id));
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
        const container = await getContainerByName(name);
        return container !== undefined;
    } catch (e) {
        dockerLogger.appendLine(`Error checking if container exists: ${getErrorMessage(e)}`);
        return false;
    }
}

//#endregion
