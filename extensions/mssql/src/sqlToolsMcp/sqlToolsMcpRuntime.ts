/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionInfo } from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import * as ConnInfo from "../models/connectionInfo";
import { IConnectionProfile, IConnectionProfileWithSource } from "../models/interfaces";
import * as Utils from "../models/utils";
import { Logger } from "../models/logger";
import {
    HeadlessQueryCancellationToken,
    HeadlessQueryExecutor,
} from "../queryExecution/headlessQueryExecutor";
import {
    BridgeConnectionInfo,
    BridgeErrorCode,
    BridgePlatformContext,
    BridgeRequestError,
    ExecuteQueryRequest,
    ExecuteQueryResponse,
    RegisterConnectionRequest,
    RegisterConnectionResponse,
    RemoveConnectionRequest,
    RemoveConnectionResponse,
} from "./contracts";
import { normalizeSqlToolsMcpQuery } from "./queryNormalizer";
import { toSqlToolsMcpQueryResult } from "./sqlToolsMcpResultFormatter";
import { PlatformContextDetector } from "./platformContextDetector";
import { TelemetryActions } from "../sharedInterfaces/telemetry";
import {
    getElapsedMs,
    getQueryTelemetryProperties,
    sendSqlToolsMcpAction,
    sendSqlToolsMcpError,
} from "./sqlToolsMcpTelemetry";
import {
    SqlToolsMcpRegisteredConnection,
    sqlToolsMcpConnectionRegistry,
} from "./sqlToolsMcpConnectionRegistry";

export class SqlToolsMcpRuntime {
    private readonly registeredConnections = sqlToolsMcpConnectionRegistry;
    private readonly platformContextDetector: PlatformContextDetector;

    constructor(
        private readonly connectionManager: ConnectionManager,
        private readonly executor: HeadlessQueryExecutor,
        private readonly logger: Logger,
    ) {
        this.platformContextDetector = new PlatformContextDetector(executor);
    }

    async isAvailable(): Promise<{ isAvailable: boolean }> {
        await this.connectionManager.initialized.promise;
        return { isAvailable: true };
    }

    async getAvailableConnections(): Promise<{ connections: BridgeConnectionInfo[] }> {
        const profiles = await this.getSavedProfiles();
        sendSqlToolsMcpAction(
            TelemetryActions.SqlToolsMcpListConnections,
            {
                success: "true",
            },
            {
                connectionCount: profiles.length,
            },
        );
        return {
            connections: profiles.map((profile) => this.toBridgeConnectionInfo(profile)),
        };
    }

    async connect(params: {
        connectionName?: string;
    }): Promise<{ connection: BridgeConnectionInfo }> {
        const startTime = performance.now();
        try {
            const connectionName = params?.connectionName;
            if (!connectionName) {
                throw new BridgeRequestError(
                    BridgeErrorCode.InvalidRequest,
                    "Connection name is required.",
                );
            }

            const profile = await this.findProfileByName(connectionName);
            if (!profile) {
                throw new BridgeRequestError(BridgeErrorCode.NotFound, "Connection was not found.");
            }

            const connection = this.toBridgeConnectionInfo(profile);
            if (!connection.connectionHandle) {
                throw new BridgeRequestError(
                    BridgeErrorCode.Unavailable,
                    "Connection does not have a usable handle.",
                );
            }

            sendSqlToolsMcpAction(
                TelemetryActions.SqlToolsMcpConnect,
                {
                    success: "true",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            return { connection };
        } catch (error) {
            sendSqlToolsMcpError(
                TelemetryActions.SqlToolsMcpConnect,
                error,
                {
                    success: "false",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            throw error;
        }
    }

    async registerConnection(
        params: RegisterConnectionRequest,
    ): Promise<RegisterConnectionResponse> {
        const startTime = performance.now();
        try {
            if (!params?.connectionName) {
                throw new BridgeRequestError(
                    BridgeErrorCode.InvalidRequest,
                    "Registered connection name is required.",
                );
            }
            if (!params.connectionHandle) {
                throw new BridgeRequestError(
                    BridgeErrorCode.InvalidRequest,
                    "Connection handle is required.",
                );
            }

            const previous = this.registeredConnections.get(params.connectionName);
            if (previous) {
                this.registeredConnections.delete(params.connectionName);
                previous.disposed = true;
                await this.cleanupContext(previous);
            }

            const profile = await this.findProfileByHandle(params.connectionHandle);
            if (!profile) {
                throw new BridgeRequestError(BridgeErrorCode.NotFound, "Connection was not found.");
            }

            const ownerUri = Utils.generateQueryUri("vscode-mssql-sqltools-mcp").toString();
            const credentials = { ...profile } as IConnectionProfile;
            const connected = await this.connectionManager.connect(ownerUri, credentials, {
                shouldHandleErrors: false,
                connectionSource: "sqlToolsMcp",
            });
            if (!connected) {
                throw new BridgeRequestError(
                    BridgeErrorCode.AuthenticationFailed,
                    "Connection could not be established.",
                    true,
                );
            }

            const connectionInfo = this.connectionManager.getConnectionInfo(ownerUri);
            const connectedCredentials = connectionInfo?.credentials;
            const platformContext = await this.detectPlatformContext(
                ownerUri,
                connectedCredentials,
            );

            this.registeredConnections.set(params.connectionName, {
                connectionHandle: params.connectionHandle,
                ownerUri,
                platformContext,
                disposed: false,
                queryTail: Promise.resolve(),
            });

            sendSqlToolsMcpAction(
                TelemetryActions.SqlToolsMcpRegisterConnection,
                {
                    success: "true",
                    replacedExistingConnection: String(Boolean(previous)),
                    hasPlatformContext: String(
                        Object.keys(platformContext.contextSettings).length > 0,
                    ),
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            return { platformContext };
        } catch (error) {
            sendSqlToolsMcpError(
                TelemetryActions.SqlToolsMcpRegisterConnection,
                error,
                {
                    success: "false",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            throw error;
        }
    }

    async executeQuery(
        params: ExecuteQueryRequest,
        cancellationToken?: HeadlessQueryCancellationToken,
    ): Promise<ExecuteQueryResponse> {
        const startTime = performance.now();
        const queryProperties = getQueryTelemetryProperties(params?.queryContentDescriptor);
        try {
            if (!params?.connectionName) {
                throw new BridgeRequestError(
                    BridgeErrorCode.InvalidRequest,
                    "Registered connection name is required.",
                );
            }

            const context = this.registeredConnections.get(params.connectionName);
            if (!context) {
                throw new BridgeRequestError(
                    BridgeErrorCode.NotFound,
                    "Registered connection was not found.",
                );
            }

            const response = await this.runSerializedQuery(context, cancellationToken, async () => {
                const query = normalizeSqlToolsMcpQuery(params.queryContentDescriptor);
                const result = await this.executor.execute(
                    context.ownerUri,
                    query,
                    cancellationToken,
                );
                return {
                    queryResult: toSqlToolsMcpQueryResult(result),
                };
            });
            sendSqlToolsMcpAction(
                TelemetryActions.SqlToolsMcpExecuteQuery,
                {
                    ...queryProperties,
                    success: "true",
                    resultIsError: String(response.queryResult.isError),
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            return response;
        } catch (error) {
            sendSqlToolsMcpError(
                TelemetryActions.SqlToolsMcpExecuteQuery,
                error,
                {
                    ...queryProperties,
                    success: "false",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            throw error;
        }
    }

    async removeConnection(params: RemoveConnectionRequest): Promise<RemoveConnectionResponse> {
        const startTime = performance.now();
        try {
            if (!params?.connectionName) {
                throw new BridgeRequestError(
                    BridgeErrorCode.InvalidRequest,
                    "Registered connection name is required.",
                );
            }

            const context = this.registeredConnections.get(params.connectionName);
            this.registeredConnections.delete(params.connectionName);
            if (context) {
                context.disposed = true;
                await this.cleanupContext(context);
            }

            sendSqlToolsMcpAction(
                TelemetryActions.SqlToolsMcpRemoveConnection,
                {
                    success: "true",
                    removed: String(context !== undefined),
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            return { removed: context !== undefined };
        } catch (error) {
            sendSqlToolsMcpError(
                TelemetryActions.SqlToolsMcpRemoveConnection,
                error,
                {
                    success: "false",
                },
                {
                    durationMs: getElapsedMs(startTime),
                },
            );
            throw error;
        }
    }

    async dispose(): Promise<void> {
        const contexts = [...this.registeredConnections.values()];
        this.registeredConnections.clear();
        contexts.forEach((context) => {
            context.disposed = true;
        });
        await Promise.all(contexts.map((context) => this.cleanupContext(context)));
    }

    private async getSavedProfiles(): Promise<IConnectionProfileWithSource[]> {
        await this.connectionManager.initialized.promise;
        return this.connectionManager.connectionStore.readAllConnections(false);
    }

    private async findProfileByName(
        connectionName: string,
    ): Promise<IConnectionProfileWithSource | undefined> {
        const profiles = await this.getSavedProfiles();
        return profiles.find((profile) => this.getProfileName(profile) === connectionName);
    }

    private async findProfileByHandle(
        connectionHandle: string,
    ): Promise<IConnectionProfileWithSource | undefined> {
        const profiles = await this.getSavedProfiles();
        return profiles.find((profile) => profile.id === connectionHandle);
    }

    private toBridgeConnectionInfo(profile: IConnectionProfileWithSource): BridgeConnectionInfo {
        return {
            name: this.getProfileName(profile),
            description: ConnInfo.getPicklistDescription(profile),
            serverName: profile.server,
            databaseName: profile.database,
            providerName: "vscode",
            connectionHandle: profile.id,
        };
    }

    private getProfileName(profile: IConnectionInfo): string {
        const profileName = (profile as IConnectionProfile).profileName;
        return profileName || ConnInfo.getSimpleConnectionDisplayName(profile);
    }

    private async detectPlatformContext(
        ownerUri: string,
        connectionInfo: IConnectionInfo | undefined,
    ): Promise<BridgePlatformContext> {
        const serverInfo = connectionInfo
            ? this.connectionManager.getServerInfo(connectionInfo)
            : undefined;
        return await this.platformContextDetector.detect(ownerUri, connectionInfo, serverInfo);
    }

    private async cleanupContext(context: SqlToolsMcpRegisteredConnection): Promise<void> {
        await context.queryTail;

        try {
            await this.connectionManager.disconnect(context.ownerUri);
        } catch {
            this.logger.warn("SQL Tools MCP connection cleanup failed.");
        }
    }

    private async runSerializedQuery<T>(
        context: SqlToolsMcpRegisteredConnection,
        cancellationToken: HeadlessQueryCancellationToken | undefined,
        callback: () => Promise<T>,
    ): Promise<T> {
        const previousTail = context.queryTail;
        let releaseCurrentQuery: () => void = () => undefined;
        const currentQueryTail = new Promise<void>((resolve) => {
            releaseCurrentQuery = resolve;
        });

        // STS query notifications are keyed by ownerUri, so one registered MCP
        // connection must execute only one query at a time for its shared URI.
        context.queryTail = previousTail.then(
            () => currentQueryTail,
            () => currentQueryTail,
        );

        await previousTail;

        try {
            this.throwIfQueryCannotStart(context, cancellationToken);
            return await callback();
        } finally {
            releaseCurrentQuery!();
        }
    }

    private throwIfQueryCannotStart(
        context: SqlToolsMcpRegisteredConnection,
        cancellationToken: HeadlessQueryCancellationToken | undefined,
    ): void {
        if (context.disposed) {
            throw new BridgeRequestError(
                BridgeErrorCode.NotFound,
                "Registered connection was removed.",
            );
        }

        if (cancellationToken?.isCancellationRequested) {
            throw new BridgeRequestError(BridgeErrorCode.Cancelled, "Query request was cancelled.");
        }
    }
}
