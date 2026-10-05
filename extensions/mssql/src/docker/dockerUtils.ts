/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import { createServer } from "net";
import { arch, platform } from "os";
import { PassThrough } from "stream";
import fixPath from "fix-path";
import { DockerCommandParams } from "../sharedInterfaces/localContainers";
import {
    defaultSqlServerContainerName,
    docker,
    dockerDeploymentLoggerChannelName,
    dockerPermissionErrorPatterns,
    MAX_PORT_NUMBER,
    Platform,
    windowsDockerDesktopExecutable,
    x64,
} from "../constants/constants";
import { LocalContainers, msgYes, Common } from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";
import { FormItemValidationState } from "../sharedInterfaces/form";
import { getErrorMessage } from "../utils/utils";
import { Logger } from "../models/logger";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";
import type Dockerode from "dockerode";
import { getDockerodeClient } from "./dockerodeClient";

export const invalidContainerNameValidationResult: FormItemValidationState = {
    isValid: false,
    validationMessage: LocalContainers.pleaseChooseUniqueContainerName,
};
export const invalidPortNumberValidationResult: FormItemValidationState = {
    isValid: false,
    validationMessage: LocalContainers.pleaseChooseUnusedPort,
};

export const dockerLogger = Logger.forChannelName(dockerDeploymentLoggerChannelName, "Docker");

export const dockerInstallErrorLink = "https://www.docker.com/products/docker-desktop/";
// Exported for testing purposes
export const windowsContainersErrorLink =
    "https://learn.microsoft.com/en-us/virtualization/windowscontainers/deploy-containers/set-up-linux-containers";
export const rosettaErrorLink =
    "https://docs.docker.com/desktop/settings-and-maintenance/settings/#general";

/**
 * Interface for parameterized commands
 */
export interface DockerCommand {
    command: string;
    args: string[];
}

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
};

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
 * Sanitizes container input by removing any characters that aren't alphanumeric, underscore, dot, or hyphen.
 */
export function sanitizeContainerInput(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.-]/g, "");
}

//#region Docker Command Implementations

export async function getContainerByName(name: string): Promise<Dockerode.Container | undefined> {
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

export interface ContainerLogMonitor {
    dispose: () => void;
    getLogs: () => string | undefined;
    includes: (text: string) => boolean;
    waitForMatch: (
        text: string,
        timeoutMs: number,
        cancellationToken?: vscode.CancellationToken,
    ) => Promise<boolean>;
}

export interface StartContainerLogMonitorOptions {
    since?: number;
    tail?: number;
    maxBufferLength?: number;
    transformChunk?: (text: string) => string;
}

export async function startContainerLogMonitor(
    container: Dockerode.Container,
    options: StartContainerLogMonitorOptions = {},
): Promise<ContainerLogMonitor> {
    const dockerClient = getDockerodeClient();
    const rawLogsStream = (await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        since: options.since,
        tail: options.tail,
    })) as NodeJS.ReadableStream;
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    dockerClient.modem.demuxStream(rawLogsStream, stdoutStream, stderrStream);

    let bufferedLogs = "";

    const appendChunk = (chunk: Buffer | string) => {
        const chunkText = options.transformChunk
            ? options.transformChunk(chunk.toString("utf8"))
            : chunk.toString("utf8");
        bufferedLogs += chunkText;

        if (
            options.maxBufferLength !== undefined &&
            bufferedLogs.length > options.maxBufferLength
        ) {
            bufferedLogs = bufferedLogs.slice(-options.maxBufferLength);
        }
    };

    stdoutStream.on("data", appendChunk);
    stderrStream.on("data", appendChunk);

    const dispose = () => {
        stdoutStream.removeListener("data", appendChunk);
        stderrStream.removeListener("data", appendChunk);
        const destroyLogStream = (
            rawLogsStream as NodeJS.ReadableStream & {
                destroy?: () => void;
            }
        ).destroy;
        destroyLogStream?.call(rawLogsStream);
    };

    return {
        dispose,
        getLogs: () => {
            const logs = bufferedLogs.trim();
            return logs.length > 0 ? logs : undefined;
        },
        includes: (text: string) => bufferedLogs.includes(text),
        waitForMatch: (
            text: string,
            timeoutMs: number,
            cancellationToken?: vscode.CancellationToken,
        ) => {
            if (bufferedLogs.includes(text)) {
                return Promise.resolve(true);
            }

            if (cancellationToken?.isCancellationRequested) {
                return Promise.resolve(false);
            }

            return new Promise<boolean>((resolve, reject) => {
                let cancellationListener: vscode.Disposable | undefined;

                const cleanup = () => {
                    clearTimeout(timeoutHandle);
                    cancellationListener?.dispose();
                    stdoutStream.removeListener("data", onData);
                    stderrStream.removeListener("data", onData);
                    rawLogsStream.removeListener("error", onError);
                    rawLogsStream.removeListener("end", onEnd);
                    rawLogsStream.removeListener("close", onEnd);
                };

                const onData = () => {
                    if (bufferedLogs.includes(text)) {
                        cleanupAndResolve(true);
                    }
                };

                const onError = (error: Error) => {
                    cleanup();
                    reject(error);
                };

                const onEnd = () => cleanupAndResolve(false);

                const cleanupAndResolve = (result: boolean) => {
                    cleanup();
                    resolve(result);
                };

                const timeoutHandle = setTimeout(() => cleanupAndResolve(false), timeoutMs);

                stdoutStream.on("data", onData);
                stderrStream.on("data", onData);
                rawLogsStream.on("error", onError);
                rawLogsStream.on("end", onEnd);
                rawLogsStream.on("close", onEnd);
                cancellationListener = cancellationToken?.onCancellationRequested(() =>
                    cleanupAndResolve(false),
                );
            });
        },
    };
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

/**
 * Checks whether an error from `docker info` (or similar) indicates a socket
 * permission problem rather than the daemon being stopped.
 */
function isDockerPermissionError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();
    return dockerPermissionErrorPatterns.some((pattern) => message.includes(pattern));
}

/**
 * Safe command execution helper that uses spawn
 */
export async function execDockerCommand(cmd: DockerCommand): Promise<string> {
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
 * @param containerName The requested container name (can be empty for auto-generation)
 * @param defaultName The default name to use when containerName is empty (defaults to SQL Server container name)
 */
export async function validateContainerName(
    containerName: string,
    defaultName: string = defaultSqlServerContainerName,
): Promise<string> {
    try {
        const dockerClient = getDockerodeClient();
        const containerInfos = await dockerClient.listContainers({ all: true });
        const existingContainers = containerInfos
            .flatMap((containerInfo) => containerInfo.Names ?? [])
            .map((name) => name.replace(/^\//, ""));
        let newContainerName = "";

        if (containerName.trim() === "") {
            newContainerName = defaultName;
            let counter = 1;

            while (existingContainers.includes(newContainerName)) {
                newContainerName = `${defaultName}_${++counter}`;
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
 * Pulls a container image from the registry.
 * @param imageName The full image name including tag
 * @param errorMessage The localized error message to use on failure
 */
export async function pullContainerImage(
    imageName: string,
    errorMessage: string,
    platform?: string,
): Promise<DockerCommandParams> {
    try {
        dockerLogger.info(`Pulling container image: ${imageName}`);
        const dockerClient = getDockerodeClient();
        const pullStream = platform
            ? await dockerClient.pull(imageName, { platform })
            : await dockerClient.pull(imageName);
        await new Promise<void>((resolve, reject) => {
            dockerClient.modem.followProgress(pullStream, (error) =>
                error ? reject(error) : resolve(),
            );
        });
        dockerLogger.info(`Container image ${imageName} pulled successfully.`);
        return { success: true };
    } catch (e) {
        dockerLogger.error(`Failed to pull container image ${imageName}: ${getErrorMessage(e)}`);
        return {
            success: false,
            error: errorMessage,
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
    cancellationTokenSource?: vscode.CancellationTokenSource,
): Promise<DockerCommandParams> {
    try {
        await execDockerCommand(COMMANDS.CHECK_DOCKER_RUNNING());
        sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.StartDocker, {
            additionalProps: {
                dockerStartedThroughExtension: "false",
            },
        });
        return { success: true };
    } catch (e) {
        // On Linux, distinguish between "daemon not running" and "permission denied on socket".
        // If it's a permission error, attempting systemctl start docker won't help and
        // triggers an unnecessary polkit prompt.
        if (platform() === Platform.Linux && isDockerPermissionError(e)) {
            return {
                success: false,
                error: LocalContainers.dockerSocketPermissionError,
                fullErrorText: getErrorMessage(e),
            };
        }
        // Otherwise docker is likely not running, so we proceed to start it.
    }
    if (node && objectExplorerService) {
        node.loadingLabel = LocalContainers.startingDockerLoadingLabel;
        await objectExplorerService.setLoadingUiForNode(node, cancellationTokenSource);
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
        dockerLogger.info("Waiting for Docker to start...");
        let startCancellationListener: vscode.Disposable | undefined;
        let dockerStartCanceled: boolean;
        try {
            dockerStartCanceled = await Promise.race([
                execDockerCommand(startCommand).then(() => false),
                new Promise<boolean>((resolve) => {
                    startCancellationListener =
                        cancellationTokenSource?.token.onCancellationRequested(() => resolve(true));
                }),
            ]);
        } finally {
            startCancellationListener?.dispose();
        }

        if (dockerStartCanceled || cancellationTokenSource?.token.isCancellationRequested) {
            return { success: false, canceled: true };
        }

        let attempts = 0;
        const maxAttempts = 30;
        const interval = 2000;

        return await new Promise((resolve) => {
            let cancellationListener: vscode.Disposable | undefined;
            let completed = false;
            const complete = (result: DockerCommandParams) => {
                if (completed) {
                    return;
                }
                completed = true;
                clearInterval(checkDocker);
                cancellationListener?.dispose();
                resolve(result);
            };

            const checkDocker = setInterval(async () => {
                try {
                    await execDockerCommand(COMMANDS.CHECK_DOCKER_RUNNING());
                    if (completed) {
                        return;
                    }
                    dockerLogger.info("Docker started successfully.");
                    sendActionEvent(TelemetryViews.LocalContainers, TelemetryActions.StartDocker, {
                        additionalProps: {
                            dockerStartedThroughExtension: "true",
                        },
                    });
                    complete({ success: true });
                } catch (e) {
                    if (completed) {
                        return;
                    }
                    if (++attempts >= maxAttempts) {
                        complete({
                            success: false,
                            error: LocalContainers.dockerFailedToStartWithinTimeout,
                            fullErrorText: getErrorMessage(e),
                        });
                    }
                }
            }, interval);
            cancellationListener = cancellationTokenSource?.token.onCancellationRequested(() =>
                complete({ success: false, canceled: true }),
            );
            if (cancellationTokenSource?.token.isCancellationRequested) {
                cancellationListener?.dispose();
            }
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
        sendErrorEvent(TelemetryViews.LocalContainers, TelemetryActions.DeleteContainer, {
            error: e,
            includeErrorMessage: false,
        });
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
        sendErrorEvent(TelemetryViews.LocalContainers, TelemetryActions.StopContainer, {
            error: e,
            includeErrorMessage: false,
        });
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
 * How many candidate ports to probe before giving up. Scanning to
 * MAX_PORT_NUMBER would mean tens of thousands of socket binds on a machine
 * where the whole range above the start port is busy.
 */
const MAX_PORT_PROBE_ATTEMPTS = 200;

/**
 * Addresses a published port has to be free on.
 *
 * Loopback is probed because that is where DAB publishes: containers bind
 * 127.0.0.1 and the CLI engine listens there too, and on Windows a wildcard
 * bind succeeds while a loopback listener holds the same port. The wildcard is
 * probed with no address at all, which is how Node binds every interface, so a
 * service listening broadly is caught as well.
 */
const HOST_PORT_PROBE_ADDRESSES: (string | undefined)[] = ["127.0.0.1", undefined];

/** Reports whether a socket can be bound to one address and port. */
function canBindAddress(host: string | undefined, port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const server = createServer();
        server.unref();
        server.once("error", () => resolve(false));
        server.listen({ ...(host ? { host } : {}), port, exclusive: true }, () => {
            server.close(() => resolve(true));
        });
    });
}

/**
 * Checks whether the host can still publish the given port.
 *
 * Docker port bindings are not the whole story: a port claimed by any other
 * process on the machine is one `docker create` will refuse to bind, and a
 * detached engine left running by an earlier session is exactly such a process.
 */
export async function isHostPortAvailable(port: number): Promise<boolean> {
    for (const host of HOST_PORT_PROBE_ADDRESSES) {
        if (!(await canBindAddress(host, port))) {
            return false;
        }
    }

    return true;
}

/**
 * Finds an available port for a new Docker container, starting from the specified port.
 * A port is available only when no container has it bound and no process on the
 * host is already listening on it.
 */
export async function findAvailablePort(
    startPort: number,
    /** Overridable so tests can drive port availability without real sockets. */
    isPortFree: (port: number) => Promise<boolean> = isHostPortAvailable,
): Promise<number> {
    try {
        const dockerClient = getDockerodeClient();
        const containerInfos = await dockerClient.listContainers({ all: true });
        const containerIds = containerInfos
            .map((containerInfo) => containerInfo.Id)
            .filter((id): id is string => Boolean(id));

        const usedPorts = containerIds.length
            ? await getUsedPortsFromContainers(containerIds)
            : new Set<number>();

        const lastPort = Math.min(startPort + MAX_PORT_PROBE_ATTEMPTS - 1, MAX_PORT_NUMBER);
        for (let port = startPort; port <= lastPort; port++) {
            if (usedPorts.has(port)) {
                continue;
            }

            if (await isPortFree(port)) {
                return port;
            }
        }
        return -1; // No available port found
    } catch {
        return -1;
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
    cancellationTokenSource?: vscode.CancellationTokenSource,
): Promise<DockerCommandParams> {
    const startDockerResult = await startDocker(
        containerNode,
        objectExplorerService,
        cancellationTokenSource,
    );
    if (!startDockerResult.success) {
        if (!startDockerResult.canceled) {
            vscode.window.showErrorMessage(startDockerResult.error);
        }
        return startDockerResult;
    }

    const containerExists = await checkContainerExists(containerName);

    if (!containerExists) {
        containerNode.loadingLabel = Common.error;
        await objectExplorerService.setLoadingUiForNode(containerNode);
        const confirmation = await vscode.window.showInformationMessage(
            LocalContainers.containerDoesNotExistError,
            { modal: true },
            Common.remove,
        );
        if (confirmation === Common.remove) {
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
        dockerLogger.error(`Error checking if container exists: ${getErrorMessage(e)}`);
        return false;
    }
}

//#endregion
