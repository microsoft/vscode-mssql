/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from "child_process";
import { platform } from "os";
import { sqlAuthentication } from "../constants/constants";
import ConnectionManager from "../controllers/connectionManager";
import { IConnectionProfile } from "../models/interfaces";

const COMMANDS = {
    CHECK_DOCKER: "docker info",
    START_DOCKER: {
        win32: 'start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"',
        // still need to test
        darwin: "open -a Docker",
        // still need to test
        linux: "systemctl start docker",
    },
    GET_CONTAINERS: `docker ps -a --format "{{.ID}}"`,
    INSPECT: (id) => `docker inspect ${id}`,
    FIND_PORTS: {
        win32: `powershell -Command "docker ps -a --format '{{.ID}}' | ForEach-Object { docker inspect $_ | Select-String -Pattern '\"HostPort\":' | Select-Object -First 1 | ForEach-Object { ($_ -split ':')[1].Trim() -replace '\"', '' }}"`,
        // still need to test
        darwin: `docker ps -a --format "{{.ID}}" | xargs -I {} sh -c 'docker inspect {} | grep -m 1 -oP "\"HostPort\": \"\K\d+"'`,
        // still need to test
        linux: `docker ps -a --format "{{.ID}}" | xargs -I {} sh -c 'docker inspect {} | grep -m 1 -oP "\"HostPort\": \"\K\d+"'`,
    },
    START_SQL_SERVER: (name, password, port, version) =>
        `docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=${password}" -p ${port}:1433 --name ${name} -d mcr.microsoft.com/mssql/server:${version}-latest`,
    CHECK_CONTAINER_RUNNING: (name) =>
        `docker ps --filter "name=${name}" --filter "status=running" --format "{{.Names}}"`,
    VALIDATE_CONTAINER_NAME: 'docker ps --format "{{.Names}}"',
    START_CONTAINER: (name) => `docker start ${name}`,
    CHECK_LOGS: (name) =>
        `docker logs --tail 15 ${name} | ${platform() === "win32" ? 'findstr "Recovery is complete"' : 'grep "Recovery is complete"'}`,
    CHECK_CONTAINER_READY: `Recovery is complete`,
};

export type DockerCommandParams = {
    success: boolean;
    error?: string;
    port?: number;
};

export async function startDocker(): Promise<DockerCommandParams> {
    return new Promise((resolve) => {
        exec(COMMANDS.CHECK_DOCKER, (err) => {
            if (!err) return resolve({ success: true });

            const startCommand = COMMANDS.START_DOCKER[platform()];

            if (!startCommand) {
                console.error("Unsupported platform for Docker:", platform());
                return resolve({ success: false, error: err.message });
            }

            exec(startCommand, (err) => {
                if (err) return resolve({ success: false, error: err.message });
                console.log("Docker started. Waiting for initialization...");

                let attempts = 0;
                const maxAttempts = 30;
                const interval = 2000;

                const checkDocker = setInterval(() => {
                    exec(COMMANDS.CHECK_DOCKER, (err) => {
                        if (!err) {
                            clearInterval(checkDocker);
                            return resolve({ success: true });
                        }
                        if (++attempts >= maxAttempts) {
                            clearInterval(checkDocker);
                            return resolve({
                                success: false,
                                error: "Docker failed to start within the timeout period.",
                            });
                        }
                    });
                }, interval);
            });
        });
    });
}

async function findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
        exec(COMMANDS.GET_CONTAINERS, (error, stdout) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return reject(-1);
            }

            const containerIds = stdout.trim().split("\n").filter(Boolean);
            if (containerIds.length === 0) return resolve(startPort);

            const usedPorts: Set<number> = new Set();
            const inspections = containerIds.map(
                (containerId) =>
                    new Promise<void>((resolve) => {
                        exec(
                            `docker inspect ${containerId}`,
                            (inspectError, inspectStdout) => {
                                if (!inspectError) {
                                    const hostPortMatches = inspectStdout.match(
                                        /"HostPort":\s*"(\d+)"/g,
                                    );
                                    hostPortMatches?.forEach((match) =>
                                        usedPorts.add(
                                            Number(match.match(/\d+/)![0]),
                                        ),
                                    );
                                } else {
                                    console.error(
                                        `Error inspecting container ${containerId}: ${inspectError.message}`,
                                    );
                                }
                                resolve();
                            },
                        );
                    }),
            );

            // @typescript-eslint/no-floating-promises
            void Promise.all(inspections).then(() => {
                let port = startPort;
                while (usedPorts.has(port)) port++;
                resolve(port);
            });
        });
    });
}

export async function startSqlServerDockerContainer(
    name,
    password,
    version,
): Promise<DockerCommandParams> {
    const port = await findAvailablePort(1433);
    return new Promise((resolve) => {
        exec(
            COMMANDS.START_SQL_SERVER(name, password, port, version),
            async (error) => {
                if (error)
                    return resolve({
                        success: false,
                        error: error.message,
                        port: undefined,
                    });
                console.log(`SQL Server container started on port ${port}.`);
                const isReady =
                    await checkIfContainerIsReadyForConnections(name);
                return resolve(
                    isReady
                        ? { success: true, port: port }
                        : {
                              success: false,
                              error: "Could not set up container",
                              port: undefined,
                          },
                );
            },
        );
    });
}

export async function isDockerContainerRunning(name): Promise<boolean> {
    return new Promise((resolve) => {
        exec(COMMANDS.CHECK_CONTAINER_RUNNING(name), (error, stdout) => {
            resolve(!error && stdout.trim() === name);
        });
    });
}

export function validateSqlServerPassword(password): boolean {
    return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/.test(
        password,
    );
}

export async function validateContainerName(containerName): Promise<boolean> {
    return new Promise((resolve) => {
        exec(COMMANDS.VALIDATE_CONTAINER_NAME, (error, stdout) => {
            resolve(!stdout.split("\n").includes(containerName));
        });
    });
}

export async function startContainer(name): Promise<boolean> {
    const isDockerStarted = await startDocker();
    if (!isDockerStarted) return false;
    return new Promise((resolve) => {
        exec(COMMANDS.START_CONTAINER(name), async (error) => {
            resolve(
                !error && (await checkIfContainerIsReadyForConnections(name)),
            );
        });
    });
}

export async function checkIfContainerIsReadyForConnections(
    name,
): Promise<boolean> {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            exec(COMMANDS.CHECK_LOGS(name), (error, stdout) => {
                if (!error && stdout.includes(COMMANDS.CHECK_CONTAINER_READY)) {
                    clearInterval(interval);
                    resolve(true);
                }
            });
        }, 1000);
    });
}

export async function addContainerConnection(
    name: string,
    password: string,
    port: number,
    connectionManager: ConnectionManager,
): Promise<IConnectionProfile> {
    const server = `localhost, ${port}`;
    const connection: any = {
        connectionString: undefined,
        profileName: name,
        encrypt: "Mandatory",
        trustServerCertificate: true,
        server: server,
        database: "",
        user: "SA",
        password: password,
        applicationName: "vscode-mssql",
        authenticationType: sqlAuthentication,
        savePassword: true,
        containerName: name,
    };

    return await connectionManager.connectionUI.saveProfile(connection);
}
