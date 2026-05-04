/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
    CancellationToken,
    createMessageConnection,
    MessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from "vscode-jsonrpc/node";
import {
    BridgeErrorCode,
    BridgeInitializeRequest,
    BridgeInitializeResponse,
    BridgeRequestError,
    bridgeResponseError,
    sqlToolsMcpBridgeProtocolVersion,
} from "./contracts";
import { SqlToolsMcpRuntime } from "./sqlToolsMcpRuntime";
import { Logger } from "../models/logger";

export enum BridgeLifecycleState {
    Inactive = "inactive",
    Listening = "listening",
    Connected = "connected",
    Ready = "ready",
    Disconnected = "disconnected",
    Disposed = "disposed",
}

export interface BridgeLaunchInfo {
    endpoint: string;
    generation: number;
}

export class SqlToolsMcpBridgeManager implements vscode.Disposable {
    private server: net.Server | undefined;
    private connection: MessageConnection | undefined;
    private socketDirectory: string | undefined;
    private endpoint: string | undefined;
    private generation = 0;
    private state = BridgeLifecycleState.Inactive;

    constructor(
        private readonly runtime: SqlToolsMcpRuntime,
        private readonly logger: Logger,
        private readonly hostVersion: string | undefined,
    ) {}

    get lifecycleState(): BridgeLifecycleState {
        return this.state;
    }

    get isReady(): boolean {
        return this.state === BridgeLifecycleState.Ready;
    }

    async prepareLaunch(): Promise<BridgeLaunchInfo> {
        await this.reset();

        this.generation += 1;
        const endpointInfo = this.createEndpoint();
        this.endpoint = endpointInfo.endpoint;
        this.socketDirectory = endpointInfo.socketDirectory;

        this.server = net.createServer((socket) => this.acceptBridgeSocket(socket));
        await new Promise<void>((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(this.endpoint, () => {
                this.server?.off("error", reject);
                resolve();
            });
        });

        this.state = BridgeLifecycleState.Listening;
        this.logger.info("SQL Tools MCP bridge is listening.");
        return {
            endpoint: this.endpoint,
            generation: this.generation,
        };
    }

    dispose(): void {
        void this.reset(BridgeLifecycleState.Disposed);
    }

    private acceptBridgeSocket(socket: net.Socket): void {
        if (this.connection) {
            this.connection.dispose();
        }

        this.state = BridgeLifecycleState.Connected;
        this.connection = createMessageConnection(
            new StreamMessageReader(socket),
            new StreamMessageWriter(socket),
        );
        this.registerHandlers(this.connection);
        this.connection.onClose(() => {
            if (this.state !== BridgeLifecycleState.Disposed) {
                this.state = BridgeLifecycleState.Disconnected;
            }
        });
        this.connection.onError(() => {
            if (this.state !== BridgeLifecycleState.Disposed) {
                this.state = BridgeLifecycleState.Disconnected;
            }
        });
        this.connection.listen();
        this.logger.info("SQL Tools MCP bridge client connected.");
    }

    private registerHandlers(connection: MessageConnection): void {
        connection.onRequest("initialize", async (params: BridgeInitializeRequest) => {
            try {
                return this.initialize(params);
            } catch (error) {
                throw bridgeResponseError(error);
            }
        });

        connection.onRequest("ping", async () => ({ ready: this.isReady }));
        connection.onRequest("health", async () => ({
            ready: this.isReady,
            state: this.lifecycleState,
        }));

        connection.onRequest("vscode/isAvailable", async () =>
            this.handleReadyRequest(() => this.runtime.isAvailable()),
        );
        connection.onRequest("vscode/getAvailableConnections", async () =>
            this.handleReadyRequest(() => this.runtime.getAvailableConnections()),
        );
        connection.onRequest("vscode/connect", async (params: { connectionName?: string }) =>
            this.handleReadyRequest(() => this.runtime.connect(params)),
        );
        connection.onRequest("vscode/registerConnection", async (params) =>
            this.handleReadyRequest(() => this.runtime.registerConnection(params)),
        );
        connection.onRequest(
            "vscode/executeQuery",
            async (params, cancellationToken: CancellationToken) =>
                this.handleReadyRequest(() => this.runtime.executeQuery(params, cancellationToken)),
        );
        connection.onRequest("vscode/removeConnection", async (params) =>
            this.handleReadyRequest(() => this.runtime.removeConnection(params)),
        );
    }

    private initialize(params: BridgeInitializeRequest): BridgeInitializeResponse {
        const requestedVersion = params?.protocolVersion ?? sqlToolsMcpBridgeProtocolVersion;
        if (!this.isCompatibleProtocol(requestedVersion)) {
            throw new BridgeRequestError(
                BridgeErrorCode.ProtocolMismatch,
                "SQL Tools MCP bridge protocol version is not compatible.",
            );
        }

        this.state = BridgeLifecycleState.Ready;
        this.logger.info("SQL Tools MCP bridge initialized.");
        return {
            protocolVersion: sqlToolsMcpBridgeProtocolVersion,
            hostIdentity: {
                name: "vscode-mssql",
                version: this.hostVersion,
            },
        };
    }

    private async handleReadyRequest<T>(callback: () => Promise<T>): Promise<T> {
        if (!this.isReady) {
            throw bridgeResponseError(
                new BridgeRequestError(
                    BridgeErrorCode.NotReady,
                    "SQL Tools MCP bridge is not initialized.",
                    true,
                ),
            );
        }

        try {
            return await callback();
        } catch (error) {
            throw bridgeResponseError(error);
        }
    }

    private isCompatibleProtocol(protocolVersion: string): boolean {
        return protocolVersion.split(".")[0] === sqlToolsMcpBridgeProtocolVersion.split(".")[0];
    }

    private async reset(
        nextState: BridgeLifecycleState = BridgeLifecycleState.Inactive,
    ): Promise<void> {
        this.connection?.dispose();
        this.connection = undefined;

        if (this.server) {
            await new Promise<void>((resolve) => this.server?.close(() => resolve()));
            this.server = undefined;
        }

        await this.runtime.dispose();
        this.removeSocketDirectory();
        this.endpoint = undefined;
        this.state = nextState;
    }

    private createEndpoint(): { endpoint: string; socketDirectory?: string } {
        const suffix = `${process.pid}-${crypto.randomUUID()}`;
        if (process.platform === "win32") {
            return {
                endpoint: `\\\\.\\pipe\\vscode-mssql-sqltools-mcp-${suffix}`,
            };
        }

        const socketDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "vscode-mssql-sqltools-mcp-"),
        );
        fs.chmodSync(socketDirectory, 0o700);
        return {
            endpoint: path.join(socketDirectory, "bridge.sock"),
            socketDirectory,
        };
    }

    private removeSocketDirectory(): void {
        if (!this.socketDirectory) {
            return;
        }

        try {
            fs.rmSync(this.socketDirectory, { recursive: true, force: true });
        } catch {
            this.logger.warn("SQL Tools MCP bridge socket cleanup failed.");
        } finally {
            this.socketDirectory = undefined;
        }
    }
}
