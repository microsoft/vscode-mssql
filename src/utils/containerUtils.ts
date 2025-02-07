/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from "child_process";
import { platform } from "os";
import { sqlAuthentication } from "../constants/constants";
import ConnectionManager from "../controllers/connectionManager";

export async function startDocker(): Promise<{
    success: boolean;
    error?: string;
}> {
    return new Promise((resolve) => {
        exec("docker info", (err) => {
            if (!err) {
                return resolve({ success: true }); // Docker is already running
            }

            console.log("Docker is not running. Attempting to start Docker...");

            let startCommand;
            switch (platform()) {
                case "win32":
                    startCommand =
                        'start "" "C:\\\\Program Files\\\\Docker\\\\Docker\\\\Docker Desktop.exe"';
                    break;
                case "darwin":
                    startCommand = "open -a Docker"; // macOS
                    break;
                case "linux":
                    startCommand = "systemctl start docker"; // Linux (may require sudo)
                    break;
                default:
                    console.error(
                        "Unsupported platform for Docker:",
                        platform(),
                    );
                    return resolve({ success: false, error: err.message });
            }

            exec(startCommand, (err) => {
                if (err) {
                    console.error("Failed to start Docker:", err);
                    return resolve({ success: false, error: err.message });
                }

                console.log("Docker started. Waiting for initialization...");

                let attempts = 0;
                const maxAttempts = 30; // Max wait time: 60s (30 * 2s)
                const interval = 2000; // Check every 2 seconds

                const checkDocker = setInterval(() => {
                    exec("docker info", (err) => {
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
    return new Promise((resolve) => {
        const checkPort = (port: number) => {
            exec(`docker ps --format \"{{.Ports}}\"`, (error, stdout) => {
                if (error) {
                    console.error("Error checking Docker ports:", error);
                    return resolve(startPort); // Default to startPort if check fails
                }

                const portsInUse = stdout
                    .split("\n")
                    .flatMap(
                        (line) =>
                            line
                                .match(/:(\d+)->1433\/tcp/g)
                                ?.map((match) =>
                                    parseInt(match.split(":")[1]),
                                ) || [],
                    );

                if (!portsInUse.includes(port)) {
                    return resolve(port);
                }
                checkPort(port + 1);
            });
        };
        checkPort(startPort);
    });
}

export async function startSqlServerDockerContainer(
    name: string,
    password: string,
    version: string,
): Promise<{ port: number; error?: string }> {
    return new Promise(async (resolve) => {
        const port = await findAvailablePort(1433);
        const command = `docker run -e \"ACCEPT_EULA=Y\" -e \"SA_PASSWORD=${password}\" -p ${port}:1433 --name ${name} -d mcr.microsoft.com/mssql/server:${version}-latest`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error("Failed to start SQL Server container:", error);
                return resolve({ port: undefined, error: error.message });
            }

            console.log(
                `SQL Server container started successfully on port ${port}.`,
            );
            return resolve({ port: port });
        });
    });
}

export async function isDockerContainerRunning(name: string): Promise<boolean> {
    return new Promise((resolve) => {
        const command = `docker ps --filter "name=${name}" --filter "status=running" --format "{{.Names}}"`;

        exec(command, (error, stdout) => {
            if (error) {
                console.error("Error checking Docker container status:", error);
                return resolve(false);
            }

            resolve(stdout.trim() === name);
        });
    });
}

export function validateSqlServerPassword(password: string): boolean {
    // Example SQL Server password validation logic (adjust as needed)
    const regex =
        /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
    return regex.test(password);
}

export async function validateContainerName(
    containerName: string,
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        exec('docker ps --format "{{.Names}}"', (error, stdout, stderr) => {
            const runningContainers = stdout.split("\n");
            resolve(!runningContainers.includes(containerName));
        });
    });
}

export async function addContainerConnection(
    name: string,
    password: string,
    port: number,
    connectionManager: ConnectionManager,
): Promise<boolean> {
    const server = `localhost, ${port}`;
    const connectionString = `Microsoft.SqlTools|itemtype:Profile|server:${server}|user:SA|isConnectionString:true`;
    const connection: any = {
        connectionString: connectionString,
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
        isLocalContainer: true,
    };

    let savedProfile =
        await connectionManager.connectionUI.saveProfile(connection);
    return savedProfile != undefined;
}
