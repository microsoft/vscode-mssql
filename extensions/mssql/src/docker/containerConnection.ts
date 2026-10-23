/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createServer, Server, Socket } from "node:net";
import { IConnectionInfo } from "vscode-mssql";
import { AzureSqlContainer } from "../constants/locConstants";
import { logger } from "../models/logger";
import { ContainerEngine } from "../sharedInterfaces/azureSqlDatabase";
import { getErrorMessage } from "../utils/utils";
import {
    ContainerEngineCommand,
    executeContainerEngineCommand,
    getContainerLifecycleCommand,
} from "./containerEngine";

type ContainerTarget = Partial<Pick<IConnectionInfo, "containerEngine" | "containerName">>;

// Use the engine's binary-safe, non-TTY exec stream, not host/VM port forwarding.
// Bash and cat are included in the provisioned SQL image; no guest tools are installed.
const relayScript =
    'exec 3<>/dev/tcp/127.0.0.1/1433 || exit; cat <&3 & reader=$!; trap \'kill "$reader" 2>/dev/null; wait "$reader" 2>/dev/null\' EXIT; cat >&3';

interface ContainerTunnel {
    server: Server;
    sockets: Set<Socket>;
    children: Set<ChildProcessWithoutNullStreams>;
    controller: AbortController;
    ready: Promise<string>;
    endpoint?: string;
}

export function needsContainerConnection(target: ContainerTarget): target is {
    containerName: string;
    containerEngine: ContainerEngine.Podman | ContainerEngine.WslContainer;
} {
    return (
        !!target.containerName &&
        (target.containerEngine === ContainerEngine.Podman ||
            target.containerEngine === ContainerEngine.WslContainer)
    );
}

function spawnRelay(command: ContainerEngineCommand): ChildProcessWithoutNullStreams {
    return spawn(command.executable, command.args, { windowsHide: true, stdio: "pipe" });
}

export class ContainerConnections {
    private readonly tunnels = new Map<string, ContainerTunnel>();
    private readonly log = logger.withPrefix("ContainerConnection");

    constructor(
        private readonly executeCommand = executeContainerEngineCommand,
        private readonly createRelay = spawnRelay,
    ) {}

    getServer(target: ContainerTarget): string | undefined {
        return this.tunnels.get(this.key(target))?.endpoint;
    }

    async prepare(target: ContainerTarget): Promise<string | undefined> {
        if (!needsContainerConnection(target)) {
            return undefined;
        }
        const { containerEngine, containerName } = target;
        const key = this.key(target);
        let tunnel = this.tunnels.get(key);
        if (!tunnel) {
            const { executable } = getContainerLifecycleCommand(
                containerEngine,
                "inspect",
                containerName,
            );
            const sockets = new Set<Socket>();
            const children = new Set<ChildProcessWithoutNullStreams>();
            const controller = new AbortController();
            const server = createServer((socket) => {
                sockets.add(socket);
                let child: ChildProcessWithoutNullStreams;
                const fail = (error: unknown) => {
                    if (socket.destroyed) {
                        return;
                    }
                    this.log.error(
                        AzureSqlContainer.containerTransportFailed(
                            executable,
                            containerName,
                            getErrorMessage(error),
                        ),
                    );
                    socket.destroy();
                };
                socket.on("error", fail);
                socket.on("close", () => {
                    sockets.delete(socket);
                    child?.kill();
                });
                try {
                    child = this.createRelay({
                        executable,
                        args: ["exec", "-i", containerName, "/bin/bash", "-c", relayScript],
                    });
                } catch (error) {
                    fail(error);
                    return;
                }
                children.add(child);
                let stderr = "";
                child.stderr.on("data", (data: Buffer) => {
                    stderr = (stderr + data.toString()).slice(-4096);
                });
                child.on("error", fail);
                child.stdin.on("error", fail);
                child.stdout.on("error", fail);
                child.stderr.on("error", fail);
                child.on("close", (code, signal) => {
                    children.delete(child);
                    if (code && !signal && !socket.destroyed) {
                        fail(new Error(stderr.trim() || `exec exited with code ${code}`));
                    }
                    socket.end();
                });
                socket.pipe(child.stdin);
                child.stdout.pipe(socket);
            });
            tunnel = {
                server,
                sockets,
                children,
                controller,
                ready: Promise.resolve(""),
            };
            this.tunnels.set(key, tunnel);
            const pending = tunnel;
            pending.ready = (async () => {
                try {
                    // Fail before SQL login with the engine's diagnostic if exec or guest TCP
                    // is unavailable. This never reads a password or changes engine settings.
                    await this.executeCommand(
                        {
                            executable,
                            args: [
                                "exec",
                                containerName,
                                "/bin/bash",
                                "-c",
                                "exec 3<>/dev/tcp/127.0.0.1/1433",
                            ],
                        },
                        15_000,
                        controller.signal,
                    );
                    controller.signal.throwIfAborted();
                    const endpoint = await new Promise<string>((resolve, reject) => {
                        const abort = () => reject(controller.signal.reason);
                        controller.signal.addEventListener("abort", abort, { once: true });
                        server.once("error", reject);
                        server.listen(0, "127.0.0.1", () => {
                            controller.signal.removeEventListener("abort", abort);
                            server.removeListener("error", reject);
                            const address = server.address();
                            if (!address || typeof address === "string") {
                                reject(new Error(AzureSqlContainer.connectContainerFailed));
                            } else {
                                resolve(`127.0.0.1,${address.port}`);
                            }
                        });
                    });
                    controller.signal.throwIfAborted();
                    server.on("error", (error) => {
                        this.log.error(
                            AzureSqlContainer.containerTransportFailed(
                                executable,
                                containerName,
                                getErrorMessage(error),
                            ),
                        );
                        this.close(key, pending);
                    });
                    pending.endpoint = endpoint;
                    return endpoint;
                } catch (error) {
                    this.close(key, pending);
                    throw new Error(
                        AzureSqlContainer.containerTransportFailed(
                            executable,
                            containerName,
                            getErrorMessage(error),
                        ),
                        { cause: error },
                    );
                }
            })();
        }
        return tunnel.ready;
    }

    dispose(): void {
        for (const [key, tunnel] of this.tunnels) {
            this.close(key, tunnel);
        }
    }

    private key(target: ContainerTarget): string {
        return JSON.stringify([target.containerEngine, target.containerName]);
    }

    private close(key: string, tunnel: ContainerTunnel): void {
        if (this.tunnels.get(key) === tunnel) {
            this.tunnels.delete(key);
        }
        tunnel.controller.abort();
        tunnel.server.close();
        for (const socket of tunnel.sockets) {
            socket.destroy();
        }
        for (const child of tunnel.children) {
            child.kill();
        }
    }
}

export const containerConnections = new ContainerConnections();
