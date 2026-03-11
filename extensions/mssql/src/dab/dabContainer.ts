/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as tar from "tar";
import { DockerCommandParams } from "../sharedInterfaces/localContainers";
import { LocalContainers } from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";
import { Dab } from "../sharedInterfaces/dab";
import type Dockerode from "dockerode";
import { getDockerodeClient } from "../docker/dockerodeClient";
import {
    dockerLogger,
    getContainerByName,
    findAvailablePort,
    pullContainerImage,
    sanitizeContainerInput,
    validateContainerName,
} from "../docker/dockerUtils";

/**
 * Pulls the DAB container image from MCR
 */
export async function pullDabContainerImage(): Promise<DockerCommandParams> {
    return pullContainerImage(
        Dab.DAB_CONTAINER_IMAGE,
        LocalContainers.dabPullImageError,
        Dab.DAB_CONTAINER_PLATFORM,
    );
}

/**
 * Starts a DAB Docker container with the specified parameters.
 * The config file is copied into the container (not bind-mounted) so the
 * temp file on the host can be deleted immediately after container creation.
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

        const dockerClient = getDockerodeClient();
        const safeContainerName = sanitizeContainerInput(containerName);
        const dabContainerPort = `${Dab.DAB_DEFAULT_PORT}/tcp`;
        const hostPort = `${port}`;

        const createContainerOptions: Dockerode.ContainerCreateOptions = {
            Image: Dab.DAB_CONTAINER_IMAGE,
            name: safeContainerName,
            Cmd: ["--ConfigFileName", "/App/dab-config.json"],
            ExposedPorts: {
                [dabContainerPort]: {},
            },
            HostConfig: {
                PortBindings: {
                    [dabContainerPort]: [{ HostPort: hostPort }],
                },
                ExtraHosts: ["host.docker.internal:host-gateway"],
            },
        };

        const container = await dockerClient.createContainer(createContainerOptions);

        // Copy config file into the container instead of bind-mounting
        // This allows the temp file to be deleted after container creation
        // The file must be named 'dab-config.json' for proper extraction
        const configDir = path.dirname(configFilePath);
        const tarStream = tar.create(
            {
                gzip: false,
                cwd: configDir,
                portable: true,
            },
            ["dab-config.json"],
        ) as unknown as NodeJS.ReadableStream;

        await container.putArchive(tarStream, {
            path: "/App",
        });

        await container.start();

        dockerLogger.appendLine(`DAB container ${containerName} started successfully.`);
        return {
            success: true,
            port,
        };
    } catch (e) {
        dockerLogger.appendLine(`Failed to start DAB container: ${getErrorMessage(e)}`);
        return {
            success: false,
            error: LocalContainers.dabStartContainerError,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Checks if the DAB container is ready to accept connections
 * Polls the health endpoint until it responds or times out.
 * Uses setTimeout loop to avoid overlapping requests (fetch timeout is 5s, poll interval is 1s).
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

    const poll = async (): Promise<DockerCommandParams> => {
        // Check timeout before polling
        if (Date.now() - start > timeoutMs) {
            // Try to get container logs for debugging
            try {
                const container = await getContainerByName(containerName);
                if (container) {
                    const logs = await container.logs({
                        stdout: true,
                        stderr: true,
                        tail: 50,
                    });
                    dockerLogger.appendLine(`DAB container logs:\n${logs.toString()}`);
                }
            } catch {
                // Ignore log retrieval errors
            }
            return {
                success: false,
                error: LocalContainers.dabContainerReadyTimeout,
            };
        }

        try {
            // Use native fetch to check health endpoint
            const response = await fetch(`http://localhost:${port}/`, {
                method: "GET",
                signal: AbortSignal.timeout(5000),
            });

            // DAB returns various status codes, but any response means it's running
            if (response.status >= 200 && response.status < 500) {
                dockerLogger.appendLine(
                    `DAB container ${containerName} is ready! (HTTP ${response.status})`,
                );
                return { success: true, port };
            }
        } catch {
            // Ignore errors and retry - container may not be ready yet
        }

        // Schedule next poll after current attempt finishes
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        return poll();
    };

    return poll();
}

/**
 * Stops and removes a DAB container
 * @param containerName Name of the container to stop and remove
 */
export async function stopAndRemoveDabContainer(
    containerName: string,
): Promise<DockerCommandParams> {
    try {
        const container = await getContainerByName(containerName);
        if (!container) {
            dockerLogger.appendLine(`DAB container ${containerName} does not exist.`);
            return { success: true }; // Container doesn't exist, consider it removed
        }

        dockerLogger.appendLine(`Stopping DAB container: ${containerName}`);
        try {
            await container.stop();
        } catch {
            // Container might already be stopped
        }

        dockerLogger.appendLine(`Removing DAB container: ${containerName}`);
        await container.remove();

        dockerLogger.appendLine(`DAB container ${containerName} stopped and removed.`);
        return { success: true };
    } catch (e) {
        dockerLogger.appendLine(`Failed to stop/remove DAB container: ${getErrorMessage(e)}`);
        return {
            success: false,
            error: LocalContainers.dabStopContainerError,
            fullErrorText: getErrorMessage(e),
        };
    }
}

/**
 * Validates and returns a unique container name for DAB
 * @param containerName The requested container name (can be empty for auto-generation)
 */
export async function validateDabContainerName(containerName: string): Promise<string> {
    return validateContainerName(containerName, Dab.DAB_DEFAULT_CONTAINER_NAME);
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
