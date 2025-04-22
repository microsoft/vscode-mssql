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

// TODO: test linux containers
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
        linux: ``,
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
        `docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=${password}" -p ${port}:1433 --name ${name} ${hostname ? `--hostname ${hostname}` : ""} -d mcr.microsoft.com/mssql/server:${version}-latest`,
    CHECK_CONTAINER_RUNNING: (name: string) =>
        `docker ps --filter "name=${name}" --filter "status=running" --format "{{.Names}}"`,
    VALIDATE_CONTAINER_NAME: 'docker ps -a --format "{{.Names}}"',
    START_CONTAINER: (name: string) => `docker start ${name}`,
    CHECK_LOGS: (name: string, platform: string) =>
        `docker logs --tail 15 ${name} | ${platform === "win32" ? 'findstr "Recovery is complete"' : 'grep "Recovery is complete"'}`,
    CHECK_CONTAINER_READY: `Recovery is complete`,
    STOP_CONTAINER: (name: string) => `docker stop ${name}`,
    DELETE_CONTAINER: (name: string) => `docker stop ${name} && docker rm ${name}`,
    GET_CONTAINER_ADDRESSES: {
        win32: `powershell -Command "docker ps -a --format '{{.ID}}' | ForEach-Object { docker inspect $_ | Select-String -Pattern '\"HostIp\":| \"HostPort\":' | Select-Object -First 1 | ForEach-Object { ($_ -split ':')[1].Trim() -replace '\"', '' }}"`,
        darwin: `docker ps -a --format "{{.ID}}" | xargs -I {} sh -c 'docker inspect {} | grep -m 1 -oP "\"HostPort\": \"\K\d+"'`,
        // still need to test
        linux: `docker ps -a --format "{{.ID}}" | xargs -I {} sh -c 'docker inspect {} | grep -m 1 -oP "\"HostPort\": \"\K\d+"'`,
    },
};

export function initializeDockerSteps(): DockerStep[] {
    return [
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: "Checking if Docker is installed",
            bodyText: "Checking if Docker is installed and running.",
            stepAction: checkDockerInstallation,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: "Starting Docker",
            bodyText: "Starting Docker Desktop.",
            stepAction: startDocker,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: "Starting Docker Engine",
            bodyText: "Starting Docker Engine.",
            stepAction: checkEngine,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: ["containerName", "password", "version", "hostname", "port"],
            headerText: "Creating container",
            bodyText: "Starting container.",
            stepAction: startSqlServerDockerContainer,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: ["containerName"],
            headerText: "Readying container for connections",
            bodyText: "Readying container for connections.",
            stepAction: checkIfContainerIsReadyForConnections,
        },
        {
            loadState: ApiStatus.Loading,
            argNames: [],
            headerText: "Connecting to container",
            bodyText: "Connecting to container.",
            stepAction: undefined,
        },
    ];
}

export function validateSqlServerPassword(password: string): string {
    if (password.length < 8) {
        return "Please make your password at least 8 characters long.";
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
        return "Your password must contain characters from at least three of the following categories: uppercase letters, lowercase letters, numbers (0-9), and special characters (!, $, #, %, etc.).";
    }

    return "";
}

export function validateConnectionName(connectionName: string): boolean {
    const connections = vscode.workspace.getConfiguration("mssql").get("connections", []);
    const isDuplicate = connections.some((profile) => profile.profileName === connectionName);
    return !isDuplicate;
}

export async function checkDockerInstallation(): Promise<DockerCommandParams> {
    return new Promise((resolve) => {
        exec(COMMANDS.CHECK_DOCKER, (error) => {
            if (error) {
                resolve({
                    success: false,
                    error: "Docker is not installed or not in PATH",
                });
            } else {
                resolve({
                    success: true,
                });
            }
        });
    });
}

export async function checkEngine(): Promise<DockerCommandParams> {
    return new Promise((resolve) => {
        const engineCommand = COMMANDS.CHECK_ENGINE[platform()];

        if (!engineCommand) {
            return resolve({
                success: false,
                error: `Unsupported platform for Docker: ${platform()}`,
            });
        }
        if (platform() === "linux") {
            return resolve({
                success: true,
            });
        }

        exec(engineCommand, (error) => {
            if (error) {
                return resolve({
                    success: false,
                    error:
                        platform() === "darwin"
                            ? "Please make sure Rosetta is turned on"
                            : "Please switch docker engine to linux containers",
                });
            }

            return resolve({
                success: true,
            });
        });
    });
}

export async function validateContainerName(containerName: string): Promise<string> {
    return new Promise((resolve) => {
        exec(COMMANDS.VALIDATE_CONTAINER_NAME, (_error, stdout) => {
            let existingContainers: string[] = [];
            if (stdout) {
                existingContainers = stdout.trim().split("\n");
            }

            let newContainerName = "";
            if (containerName.trim() === "") {
                newContainerName = "sql_server_container";
                let counter = 1;

                while (existingContainers.includes(newContainerName)) {
                    newContainerName = `sql_server_container_${++counter}`;
                }
            } else if (
                !existingContainers.includes(containerName) &&
                /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)
            ) {
                newContainerName = containerName;
            }
            resolve(newContainerName);
        });
    });
}

export async function findAvailablePort(startPort: number): Promise<number> {
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
                        exec(`docker inspect ${containerId}`, (inspectError, inspectStdout) => {
                            if (!inspectError) {
                                const hostPortMatches =
                                    inspectStdout.match(/"HostPort":\s*"(\d+)"/g);
                                hostPortMatches?.forEach((match) =>
                                    usedPorts.add(Number(match.match(/\d+/)![0])),
                                );
                            } else {
                                console.error(
                                    `Error inspecting container ${containerId}: ${inspectError.message}`,
                                );
                            }
                            resolve();
                        });
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
    containerName: string,
    password: string,
    version: string,
    hostname: string,
    port: number,
): Promise<DockerCommandParams> {
    console.log(
        COMMANDS.START_SQL_SERVER(containerName, password, port, Number(version), hostname),
    );
    return new Promise((resolve) => {
        exec(
            COMMANDS.START_SQL_SERVER(containerName, password, port, Number(version), hostname),
            async (error) => {
                if (error) {
                    console.log(error);
                    return resolve({
                        success: false,
                        error: error.message,
                        port: undefined,
                    });
                }
                console.log(`SQL Server container ${containerName} started on port ${port}.`);
                return resolve({
                    success: true,
                    port: port,
                });
            },
        );
    });
}

export async function isDockerContainerRunning(name: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(COMMANDS.CHECK_CONTAINER_RUNNING(name), (error, stdout) => {
            resolve(!error && stdout.trim() === name);
        });
    });
}

export async function startDocker(): Promise<DockerCommandParams> {
    return new Promise((resolve) => {
        const startCommand = COMMANDS.START_DOCKER[platform()];

        if (!startCommand) {
            return resolve({
                success: false,
                error: `Unsupported platform for Docker: ${platform()}`,
            });
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
}

export async function restartContainer(containerName: string): Promise<boolean> {
    const isDockerStarted = await startDocker();
    if (!isDockerStarted) return false;
    const containerRunning = await isDockerContainerRunning(containerName);
    if (containerRunning) {
        return true;
    }
    return new Promise((resolve) => {
        exec(COMMANDS.START_CONTAINER(containerName), async (error) => {
            resolve(!error && (await checkIfContainerIsReadyForConnections(containerName)).success);
        });
    });
}

export async function checkIfContainerIsReadyForConnections(
    containerName: string,
): Promise<DockerCommandParams> {
    return new Promise((resolve) => {
        const timeoutMs = 30_000;
        const intervalMs = 1000;
        const start = Date.now();

        const interval = setInterval(() => {
            exec(COMMANDS.CHECK_LOGS(containerName, platform()), (error, stdout) => {
                if (stdout?.includes(COMMANDS.CHECK_CONTAINER_READY)) {
                    clearInterval(interval);
                    resolve({ success: true });
                } else if (Date.now() - start > timeoutMs) {
                    clearInterval(interval);
                    resolve({
                        success: false,
                        error: "Timeout: Container did not become ready in time.",
                    });
                }
            });
        }, intervalMs);
    });
}
export async function deleteContainer(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(COMMANDS.DELETE_CONTAINER(containerName), (error) => {
            if (error) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
}

export async function stopContainer(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(COMMANDS.STOP_CONTAINER(containerName), (error) => {
            if (error) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
}

// Returns container name if container is a Docker connection
export async function checkIfConnectionIsDockerContainer(serverName: string): Promise<string> {
    if (!serverName.includes("localhost") && !serverName.includes("127.0.0.1")) return "";

    return new Promise((resolve) => {
        exec(COMMANDS.GET_CONTAINERS, (error, stdout) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return resolve("");
            }

            const containerIds = stdout.trim().split("\n").filter(Boolean);
            if (containerIds.length === 0) return resolve("");

            const inspections = containerIds.map(
                (containerId) =>
                    new Promise<string>((resolve) => {
                        exec(`docker inspect ${containerId}`, (inspectError, inspectStdout) => {
                            if (inspectError) {
                                console.error(
                                    `Error inspecting container ${containerId}: ${inspectError.message}`,
                                );
                                return resolve("");
                            }

                            const hostPortMatches = inspectStdout.match(/"HostPort":\s*"(\d+)"/g);
                            if (hostPortMatches) {
                                for (const match of hostPortMatches) {
                                    const portMatch = match.match(/\d+/);
                                    if (portMatch && serverName.includes(portMatch[0])) {
                                        const containerNameMatch =
                                            inspectStdout.match(/"Name"\s*:\s*"\/([^"]+)"/);
                                        if (containerNameMatch) {
                                            return resolve(containerNameMatch[1]); // Extract container name
                                        }
                                    }
                                }
                            }
                            resolve("");
                        });
                    }),
            );

            void Promise.all(inspections).then((results) => {
                const foundContainer = results.find((name) => name !== ""); // Get first valid container name
                resolve(foundContainer || ""); // Return container name or empty string if not found
            });
        });
    });
}

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
        for (let i = currentStep + 1; i < steps.length; i++) {
            steps[i].loadState = ApiStatus.Error;
        }
    }
    return steps;
}
