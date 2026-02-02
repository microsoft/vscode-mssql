/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from "child_process";
import { platform } from "os";
import * as path from "path";
import fixPath from "fix-path";
import { docker } from "../constants/constants";

/**
 * Interface for shell commands
 */
export interface ShellCommand {
    command: string;
    args: string[];
}

/**
 * OS-level commands for Docker Desktop management.
 * These commands are needed because the Docker API cannot start Docker Desktop itself.
 */
export const OS_COMMANDS = {
    /**
     * Get the path to the Docker executable (Windows only)
     */
    GET_DOCKER_PATH: (): ShellCommand => ({
        command: "powershell.exe",
        args: ["-Command", "(Get-Command docker).Source"],
    }),

    /**
     * Start Docker Desktop on each platform
     */
    START_DOCKER: (dockerPath: string) => ({
        win32: {
            command: "cmd.exe",
            args: ["/c", "start", "", dockerPath],
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

    /**
     * Check if Rosetta is enabled on macOS ARM (required for SQL Server containers)
     */
    CHECK_ROSETTA: {
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

    /**
     * Switch Docker Desktop to Linux containers on Windows
     */
    SWITCH_TO_LINUX_ENGINE: (dockerCliPath: string): ShellCommand => ({
        command: "powershell.exe",
        args: ["-Command", `& "${dockerCliPath}" -SwitchLinuxEngine`],
    }),
};

/**
 * Execute a shell command and return the stdout
 */
export async function execCommand(cmd: ShellCommand): Promise<string> {
    // Ensure PATH is fixed for macOS/Linux environments
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
                (error as Error & { code?: number }).code = code;
                reject(error);
            }
        });

        process.on("error", (error) => {
            reject(error);
        });
    });
}

/**
 * Execute two commands with pipe (cmd1 | cmd2)
 */
export async function execCommandWithPipe(cmd1: ShellCommand, cmd2: ShellCommand): Promise<string> {
    return new Promise((resolve, reject) => {
        const process1 = spawn(cmd1.command, cmd1.args);
        const process2 = spawn(cmd2.command, cmd2.args);

        let output = "";
        let errorOutput = "";

        // Pipe first process output to second process
        process1.stdout.pipe(process2.stdin);

        process2.stdout.on("data", (data) => {
            output += data.toString();
        });

        process1.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });

        process2.on("close", (code) => {
            if (code === 0 || code === 1) {
                // grep returns 1 when no matches found
                resolve(output.trim());
            } else {
                reject(new Error(errorOutput || `Command failed with code ${code}`));
            }
        });

        process1.on("error", reject);
        process2.on("error", reject);
    });
}

/**
 * Find the path to a Docker executable (e.g., DockerCli.exe, Docker Desktop.exe)
 */
export async function getDockerExecutablePath(executable: string): Promise<string> {
    try {
        const stdout = await execCommand(OS_COMMANDS.GET_DOCKER_PATH());
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
 * Get the appropriate command to start Docker Desktop for the current platform
 */
export function getStartDockerCommand(dockerDesktopPath: string): ShellCommand | undefined {
    const commands = OS_COMMANDS.START_DOCKER(dockerDesktopPath);
    return commands[platform() as keyof typeof commands];
}
