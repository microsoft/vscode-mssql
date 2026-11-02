/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import { IConnectionInfo } from "vscode-mssql";
import { ContainerEngine } from "../sharedInterfaces/azureSqlDatabase";
import { AzureSqlContainer } from "../constants/locConstants";

const execFileAsync = promisify(execFile);
type Engine = NonNullable<IConnectionInfo["containerEngine"]>;

export interface ContainerEngineCommand {
    executable: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
}

export function getContainerEngineExecutable(engine: Engine): string {
    switch (engine) {
        case ContainerEngine.Docker:
            return "docker";
        case ContainerEngine.Podman:
            return "podman";
        case ContainerEngine.Containerd:
            return "nerdctl";
        case ContainerEngine.AppleContainer:
            return "container";
        case ContainerEngine.WslContainer:
            return "wslc";
        default:
            throw new Error(AzureSqlContainer.unknownContainerEngine(engine));
    }
}

export async function executeContainerEngineCommand(
    command: ContainerEngineCommand,
    timeout: number,
    signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(command.executable, command.args, {
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        signal,
        // Inherit credentials without exposing their values in command arguments.
        env: command.env ? { ...process.env, ...command.env } : undefined,
    });
}

export function getContainerLifecycleCommand(
    engine: Engine,
    action: "inspect" | "start" | "stop" | "delete",
    containerName: string,
): ContainerEngineCommand {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
        throw new Error(AzureSqlContainer.invalidContainerName);
    }
    const verb =
        action === "delete"
            ? engine === ContainerEngine.AppleContainer
                ? "delete"
                : "rm"
            : action;
    return {
        executable: getContainerEngineExecutable(engine),
        args: [
            ...(engine === ContainerEngine.WslContainer ? ["container"] : []),
            verb,
            ...(action === "delete" ? ["--force"] : []),
            containerName,
        ],
    };
}

export async function inspectContainer(
    engine: Engine,
    containerName: string,
    signal?: AbortSignal,
    executeCommand = executeContainerEngineCommand,
): Promise<boolean> {
    signal?.throwIfAborted();
    const result = await executeCommand(
        getContainerLifecycleCommand(engine, "inspect", containerName),
        30_000,
        signal,
    );
    const parsed: unknown = JSON.parse(result.stdout);
    const info: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof info === "object" && info !== null) {
        if ("State" in info && typeof info.State === "object" && info.State !== null) {
            if ("Running" in info.State && typeof info.State.Running === "boolean") {
                return info.State.Running;
            }
        }
        if ("status" in info && typeof info.status === "string") {
            return info.status === "running";
        }
    }
    throw new Error(AzureSqlContainer.invalidContainerState(getContainerEngineExecutable(engine)));
}

export async function startContainer(
    engine: Engine,
    containerName: string,
    signal?: AbortSignal,
    executeCommand = executeContainerEngineCommand,
): Promise<void> {
    if (await inspectContainer(engine, containerName, signal, executeCommand)) {
        return;
    }
    await executeCommand(
        getContainerLifecycleCommand(engine, "start", containerName),
        120_000,
        signal,
    );
    const deadline = Date.now() + 300_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
        signal?.throwIfAborted();
        try {
            // Provisioned Azure SQL containers keep the SA password in their environment.
            await executeCommand(
                {
                    executable: getContainerEngineExecutable(engine),
                    args: [
                        "exec",
                        containerName,
                        "/bin/sh",
                        "-c",
                        'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -l 5 -t 5 -Q "SELECT 1"',
                    ],
                },
                Math.max(1, Math.min(15_000, deadline - Date.now())),
                signal,
            );
            signal?.throwIfAborted();
            if (Date.now() < deadline) {
                return;
            }
        } catch (error) {
            signal?.throwIfAborted();
            lastError = error;
        }
        await setTimeout(Math.min(2_000, Math.max(0, deadline - Date.now())), undefined, {
            signal,
        });
    }
    throw new Error(AzureSqlContainer.containerNotReady, { cause: lastError });
}
