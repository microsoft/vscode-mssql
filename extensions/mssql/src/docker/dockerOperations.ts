/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Docker from "dockerode";
import { getDockerClient } from "./dockerClient";

/**
 * Maximum port number that can be used for Docker containers
 */
const MAX_PORT_NUMBER = 65535;

/**
 * Sanitizes container name by removing any characters that aren't alphanumeric, underscore, dot, or hyphen
 */
export function sanitizeContainerName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.-]/g, "");
}

/**
 * Checks if a container info matches the given name (handles Docker's leading slash)
 */
function containerHasName(containerInfo: Docker.ContainerInfo, name: string): boolean {
    return containerInfo.Names.some((n) => n === `/${name}` || n === name);
}

/**
 * List all containers (optionally including stopped containers)
 */
export async function listContainers(all = true): Promise<Docker.ContainerInfo[]> {
    const dockerApi = getDockerClient();
    return dockerApi.listContainers({ all });
}

/**
 * Get all container names (without leading slash)
 */
export async function getContainerNames(): Promise<string[]> {
    const containers = await listContainers(true);
    return containers.flatMap((c) => c.Names).map((n) => n.replace(/^\//, ""));
}

/**
 * Check if a container with the given name is currently running
 */
export async function isContainerRunning(name: string): Promise<boolean> {
    try {
        const dockerApi = getDockerClient();
        const containers = await dockerApi.listContainers({
            filters: {
                name: [name],
                status: ["running"],
            },
        });

        return containers.some((c) => containerHasName(c, name));
    } catch {
        return false;
    }
}

/**
 * Check if a container with the given name exists (running or stopped)
 */
export async function containerExists(name: string): Promise<boolean> {
    try {
        const containers = await listContainers(true);
        return containers.some((c) => containerHasName(c, name));
    } catch {
        return false;
    }
}

/**
 * Start an existing container by name
 */
export async function startContainer(name: string): Promise<void> {
    const dockerApi = getDockerClient();
    const container = dockerApi.getContainer(sanitizeContainerName(name));
    await container.start();
}

/**
 * Stop a running container by name
 */
export async function stopContainer(name: string): Promise<void> {
    const dockerApi = getDockerClient();
    const container = dockerApi.getContainer(sanitizeContainerName(name));
    await container.stop();
}

/**
 * Remove a container by name
 */
export async function removeContainer(name: string): Promise<void> {
    const dockerApi = getDockerClient();
    const container = dockerApi.getContainer(sanitizeContainerName(name));
    await container.remove();
}

/**
 * Get container logs
 * @param name Container name
 * @param since Unix timestamp (seconds) to get logs since
 */
export async function getContainerLogs(name: string, since?: number): Promise<string> {
    const dockerApi = getDockerClient();
    const container = dockerApi.getContainer(sanitizeContainerName(name));
    const logs = await container.logs({
        stdout: true,
        stderr: true,
        since,
        follow: false,
    });
    return logs.toString();
}

/**
 * Get container name by container ID
 */
export async function getContainerNameById(containerId: string): Promise<string | undefined> {
    try {
        const dockerApi = getDockerClient();
        const containers = await dockerApi.listContainers({
            all: true,
            filters: { id: [containerId] },
        });

        if (containers.length > 0) {
            return containers[0].Names[0].replace(/^\//, "");
        }
    } catch {}
    return undefined;
}

/**
 * Get all ports currently in use by Docker containers
 */
export async function getUsedPorts(): Promise<Set<number>> {
    const usedPorts = new Set<number>();

    try {
        const containers = await listContainers(true);
        for (const containerInfo of containers) {
            if (containerInfo.Ports) {
                for (const portInfo of containerInfo.Ports) {
                    if (portInfo.PublicPort) {
                        usedPorts.add(portInfo.PublicPort);
                    }
                }
            }
        }
    } catch {}

    return usedPorts;
}

/**
 * Find an available port starting from the given port
 */
export async function findAvailablePort(startPort: number): Promise<number> {
    const usedPorts = await getUsedPorts();

    if (usedPorts.size === 0) {
        return startPort;
    }

    for (let port = startPort; port <= MAX_PORT_NUMBER; port++) {
        if (!usedPorts.has(port)) {
            return port;
        }
    }

    return -1; // No available port found
}

/**
 * Progress event during image pull
 */
export interface PullImageProgress {
    status?: string;
    progress?: string;
}

/**
 * Pull a Docker image with optional progress callback
 */
export async function pullImage(
    imageTag: string,
    onProgress?: (event: PullImageProgress) => void,
): Promise<void> {
    const dockerApi = getDockerClient();

    return new Promise<void>((resolve, reject) => {
        dockerApi.pull(imageTag, {}, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) {
                reject(err);
                return;
            }

            dockerApi.modem.followProgress(
                stream,
                (err: Error | null) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                },
                onProgress,
            );
        });
    });
}

/**
 * Create and start a new container
 */
export async function createAndStartContainer(
    config: Docker.ContainerCreateOptions,
): Promise<Docker.Container> {
    const dockerApi = getDockerClient();
    const container = await dockerApi.createContainer(config);
    await container.start();
    return container;
}

/**
 * Generate a unique container name based on a base name
 */
export async function generateUniqueContainerName(baseName: string): Promise<string> {
    const existingNames = await getContainerNames();
    let newName = baseName;
    let counter = 1;

    while (existingNames.includes(newName)) {
        newName = `${baseName}_${++counter}`;
    }

    return newName;
}

/**
 * Validate that a container name is unique and properly formatted
 */
export async function validateContainerName(containerName: string): Promise<string> {
    const existingNames = await getContainerNames();

    if (containerName.trim() === "") {
        return "";
    }

    if (
        !existingNames.includes(containerName) &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)
    ) {
        return containerName;
    }

    return "";
}
