/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Docker from "dockerode";
import { platform } from "os";
import { Platform } from "../constants/constants";

/**
 * Lazy-initialized Docker client instance
 */
let dockerClient: Docker | undefined = undefined;

/**
 * Gets or creates a Docker client instance.
 * The client connects via the platform-appropriate socket/pipe.
 */
export function getDockerClient(): Docker {
    if (!dockerClient) {
        dockerClient = createDockerClient();
    }
    return dockerClient;
}

/**
 * Creates a new Docker client with platform-specific configuration.
 */
function createDockerClient(): Docker {
    if (platform() === Platform.Windows) {
        // Windows uses named pipe
        return new Docker({ socketPath: "//./pipe/docker_engine" });
    } else {
        // macOS and Linux use Unix socket
        return new Docker({ socketPath: "/var/run/docker.sock" });
    }
}

/**
 * Resets the Docker client (useful for testing or reconnection scenarios)
 */
export function resetDockerClient(): void {
    dockerClient = undefined;
}

/**
 * Checks if docker is installed and the daemon is accessible
 */
export async function checkDockerInstallation(): Promise<boolean> {
    try {
        const dockerApi = getDockerClient();
        await dockerApi.version();
        return true;
    } catch {
        return false;
    }
}

/**
 * Pings the Docker daemon to check if it's running
 */
export async function pingDocker(): Promise<boolean> {
    try {
        const dockerApi = getDockerClient();
        await dockerApi.ping();
        return true;
    } catch {
        return false;
    }
}

/**
 * Gets Docker system information
 */
export async function getDockerInfo(): Promise<Awaited<ReturnType<Docker["info"]>>> {
    const dockerApi = getDockerClient();
    return dockerApi.info();
}
