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
import { PlatformContextDetector, toFallbackPlatformContext } from "./platformContextDetector";

interface RegisteredExecutionContext {
    connectionHandle: string;
    ownerUri: string;
    platformContext: BridgePlatformContext;
}

export class SqlToolsMcpRuntime {
    private readonly registeredConnections = new Map<string, RegisteredExecutionContext>();
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
        return {
            connections: profiles.map((profile) => this.toBridgeConnectionInfo(profile)),
        };
    }

    async connect(params: {
        connectionName?: string;
    }): Promise<{ connection: BridgeConnectionInfo }> {
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

        return { connection };
    }

    async registerConnection(
        params: RegisterConnectionRequest,
    ): Promise<RegisterConnectionResponse> {
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
        const platformContext = await this.detectPlatformContext(ownerUri, connectedCredentials);

        this.registeredConnections.set(params.connectionName, {
            connectionHandle: params.connectionHandle,
            ownerUri,
            platformContext,
        });

        return { platformContext };
    }

    async executeQuery(
        params: ExecuteQueryRequest,
        cancellationToken?: HeadlessQueryCancellationToken,
    ): Promise<ExecuteQueryResponse> {
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

        const query = normalizeSqlToolsMcpQuery(params.queryContentDescriptor);
        const result = await this.executor.execute(context.ownerUri, query, cancellationToken);
        return {
            queryResult: toSqlToolsMcpQueryResult(result),
        };
    }

    async removeConnection(params: RemoveConnectionRequest): Promise<RemoveConnectionResponse> {
        if (!params?.connectionName) {
            throw new BridgeRequestError(
                BridgeErrorCode.InvalidRequest,
                "Registered connection name is required.",
            );
        }

        const context = this.registeredConnections.get(params.connectionName);
        this.registeredConnections.delete(params.connectionName);
        if (context) {
            await this.cleanupContext(context);
        }

        return { removed: context !== undefined };
    }

    async dispose(): Promise<void> {
        const contexts = [...this.registeredConnections.values()];
        this.registeredConnections.clear();
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
        try {
            return await this.platformContextDetector.detect(ownerUri, connectionInfo, serverInfo);
        } catch {
            this.logger.warn("SQL Tools MCP platform detection failed; using minimal context.");
            return toFallbackPlatformContext(connectionInfo, serverInfo);
        }
    }

    private async cleanupContext(context: RegisteredExecutionContext): Promise<void> {
        try {
            await this.connectionManager.disconnect(context.ownerUri);
        } catch {
            this.logger.warn("SQL Tools MCP connection cleanup failed.");
        }
    }
}
