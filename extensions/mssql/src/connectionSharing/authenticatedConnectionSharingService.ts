/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import * as vscode from "vscode";
import { RequestType } from "vscode-languageclient";
import { sendActionEvent } from "extension-toolkit/vscode";
import ConnectionManager from "../controllers/connectionManager";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { IConnectionProfile } from "../models/interfaces";
import { logger } from "../models/logger";
import { ScriptOperation } from "../models/contracts/scripting/scriptingRequest";
import { ScriptingService } from "../scripting/scriptingService";
import { ILogger } from "../sharedInterfaces/logger";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { uuid } from "../utils/utils";
import { ConnectionSharingAuthenticationProvider } from "./connectionSharingAuthenticationProvider";
import { ConnectionSharingError, ConnectionSharingErrorCode } from "./connectionSharingService";

/**
 * Shares mssql connections with extensions that hold a session from
 * {@link ConnectionSharingAuthenticationProvider}. Each connection URI is tied to the session that
 * opened it, so callers can't act on URIs they didn't create, such as a query editor's.
 */
export class AuthenticatedConnectionSharingService
    implements mssql.IAuthenticatedConnectionSharingService, vscode.Disposable
{
    public readonly authenticationProviderId = Constants.connectionSharingAuthenticationProviderId;
    private readonly _logger: ILogger;
    /** The ID of the session that opened each connection URI. */
    private readonly _connectionSessionIds = new Map<string, string>();
    private readonly _sessionChangeListener: vscode.Disposable;

    constructor(
        private readonly _authenticationProvider: ConnectionSharingAuthenticationProvider,
        private readonly _client: SqlToolsServiceClient,
        private readonly _connectionManager: ConnectionManager,
        private readonly _scriptingService: ScriptingService,
    ) {
        this._logger = logger.withPrefix("AuthenticatedConnectionSharingService");
        this._sessionChangeListener = this._authenticationProvider.onDidChangeSessions((event) => {
            for (const session of event.removed ?? []) {
                this.disconnectSession(session.id);
            }
        });
    }

    public async getActiveEditorConnectionId(accessToken: string): Promise<string | undefined> {
        await this.validateAccessToken(accessToken);
        const connection = this.getActiveEditorConnection();
        this.recordApiCall("getActiveEditorConnectionId", connection);
        return connection?.id;
    }

    public async getActiveDatabase(accessToken: string): Promise<string | undefined> {
        await this.validateAccessToken(accessToken);
        const connection = this.getActiveEditorConnection();
        this.recordApiCall("getActiveDatabase", connection);
        return connection?.database;
    }

    public async getDatabaseForConnectionId(
        accessToken: string,
        connectionId: string,
    ): Promise<string | undefined> {
        await this.validateAccessToken(accessToken);
        const connection = await this.findSavedConnection(connectionId);
        this.recordApiCall("getDatabaseForConnectionId", connection);
        return connection?.database;
    }

    public async connect(
        accessToken: string,
        connectionId: string,
        database?: string,
    ): Promise<string> {
        const sessionId = await this.validateAccessToken(accessToken);
        const connection = await this.getSavedConnection(connectionId);
        this.recordApiCall("connect", connection);

        const connectionUri = uuid();
        const connected = await this._connectionManager.connect(
            connectionUri,
            database ? { ...connection, database } : connection,
            { connectionSource: "authenticatedConnectionSharingService" },
        );
        if (!connected) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.CONNECTION_FAILED,
                LocalizedConstants.ConnectionSharing.failedToEstablishConnectionError(connectionId),
                undefined,
                connectionId,
            );
        }

        // The session can end while the connection is opening; don't leave an orphaned connection.
        if (
            (await this._authenticationProvider.getSessionIdForAccessToken(accessToken)) !==
            sessionId
        ) {
            void this._connectionManager.disconnect(connectionUri);
            throw this.invalidAccessTokenError();
        }

        this._connectionSessionIds.set(connectionUri, sessionId);
        return connectionUri;
    }

    public async disconnect(accessToken: string, connectionUri: string): Promise<void> {
        await this.validateOwnedConnectionUri(accessToken, connectionUri);
        this.recordApiCallForUri("disconnect", connectionUri);
        this._connectionSessionIds.delete(connectionUri);
        await this._connectionManager.disconnect(connectionUri);
    }

    public async isConnected(accessToken: string, connectionUri: string): Promise<boolean> {
        const sessionId = await this.validateAccessToken(accessToken);
        this.recordApiCallForUri("isConnected", connectionUri);
        return (
            this._connectionSessionIds.get(connectionUri) === sessionId &&
            this._connectionManager.isConnected(connectionUri)
        );
    }

    public async executeSimpleQuery(
        accessToken: string,
        connectionUri: string,
        queryString: string,
    ): Promise<mssql.SimpleExecuteResult> {
        await this.validateActiveConnection(accessToken, connectionUri);
        this.recordApiCallForUri("executeSimpleQuery", connectionUri);
        return await this._client.sendRequest(
            new RequestType<
                { ownerUri: string; queryString: string },
                mssql.SimpleExecuteResult,
                void
            >("query/simpleexecute"),
            { ownerUri: connectionUri, queryString },
        );
    }

    public async getServerInfo(
        accessToken: string,
        connectionUri: string,
    ): Promise<mssql.IServerInfo> {
        await this.validateActiveConnection(accessToken, connectionUri);
        this.recordApiCallForUri("getServerInfo", connectionUri);
        return this._connectionManager.getServerInfo(
            this._connectionManager.getConnectionInfoFromUri(connectionUri),
        );
    }

    public async listDatabases(accessToken: string, connectionUri: string): Promise<string[]> {
        await this.validateActiveConnection(accessToken, connectionUri);
        this.recordApiCallForUri("listDatabases", connectionUri);
        return await this._connectionManager.listDatabases(connectionUri);
    }

    public async scriptObject(
        accessToken: string,
        connectionUri: string,
        operation: ScriptOperation,
        scriptingObject: mssql.IScriptingObject,
    ): Promise<string | undefined> {
        await this.validateActiveConnection(accessToken, connectionUri);
        this.recordApiCallForUri("scriptObject", connectionUri);
        await this._connectionManager.refreshAzureAccountToken(connectionUri);

        const serverInfo = this._connectionManager.getServerInfo(
            this._connectionManager.getConnectionInfoFromUri(connectionUri),
        );
        const scriptingParams = this._scriptingService.createScriptingRequestParams(
            serverInfo,
            scriptingObject,
            connectionUri,
            operation,
        );
        return await this._scriptingService.script(scriptingParams);
    }

    public async getConnectionString(
        accessToken: string,
        connectionId: string,
    ): Promise<string | undefined> {
        await this.validateAccessToken(accessToken);
        const connection = await this.getSavedConnection(connectionId);
        this.recordApiCall("getConnectionString", connection);

        return await this._connectionManager.getConnectionString(
            this._connectionManager.createConnectionDetails(connection),
            true, // includePassword
            false, // do not include appName
        );
    }

    public dispose(): void {
        this._sessionChangeListener.dispose();
    }

    /** Returns the ID of the session that issued the access token. */
    private async validateAccessToken(accessToken: string): Promise<string> {
        const sessionId =
            await this._authenticationProvider.getSessionIdForAccessToken(accessToken);
        if (!sessionId) {
            throw this.invalidAccessTokenError();
        }
        return sessionId;
    }

    private async validateOwnedConnectionUri(
        accessToken: string,
        connectionUri: string,
    ): Promise<void> {
        const sessionId = await this.validateAccessToken(accessToken);
        if (!connectionUri || this._connectionSessionIds.get(connectionUri) !== sessionId) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                LocalizedConstants.ConnectionSharing.invalidConnectionUri,
            );
        }
    }

    private async validateActiveConnection(
        accessToken: string,
        connectionUri: string,
    ): Promise<void> {
        await this.validateOwnedConnectionUri(accessToken, connectionUri);
        if (!this._connectionManager.isConnected(connectionUri)) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                LocalizedConstants.ConnectionSharing.connectionNotActive,
            );
        }
    }

    private getActiveEditorConnection(): IConnectionProfile | undefined {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
                LocalizedConstants.ConnectionSharing.noActiveEditorError,
            );
        }

        const activeEditorUri = activeEditor.document.uri.toString();
        if (!this._connectionManager.isConnected(activeEditorUri)) {
            return undefined;
        }
        return this._connectionManager.getConnectionInfoFromUri(
            activeEditorUri,
        ) as IConnectionProfile;
    }

    private async findSavedConnection(
        connectionId: string,
    ): Promise<IConnectionProfile | undefined> {
        const connections =
            await this._connectionManager.connectionStore.connectionConfig.getConnections();
        return connections.find((connection) => connection.id === connectionId);
    }

    private async getSavedConnection(connectionId: string): Promise<IConnectionProfile> {
        const connection = await this.findSavedConnection(connectionId);
        if (!connection) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
                LocalizedConstants.ConnectionSharing.connectionNotFoundError(connectionId),
                undefined,
                connectionId,
            );
        }
        return connection;
    }

    private disconnectSession(sessionId: string): void {
        for (const [connectionUri, ownerSessionId] of this._connectionSessionIds) {
            if (ownerSessionId !== sessionId) {
                continue;
            }
            this._connectionSessionIds.delete(connectionUri);
            void Promise.resolve(this._connectionManager.disconnect(connectionUri)).catch(
                (error) => {
                    this._logger.error(
                        "Failed to close a connection after its session ended.",
                        error,
                    );
                },
            );
        }
    }

    private invalidAccessTokenError(): ConnectionSharingError {
        return new ConnectionSharingError(
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
            LocalizedConstants.ConnectionSharing.invalidAccessToken,
        );
    }

    private recordApiCallForUri(method: string, connectionUri: string): void {
        this.recordApiCall(
            method,
            this._connectionManager.getConnectionInfoFromUri(connectionUri) as
                | IConnectionProfile
                | undefined,
        );
    }

    private recordApiCall(method: string, connection: IConnectionProfile | undefined): void {
        sendActionEvent(
            TelemetryViews.Connection,
            TelemetryActions.AuthenticatedConnectionSharingApiCalled,
            {
                additionalProps: {
                    method,
                    authenticationType: connection?.authenticationType?.toString() ?? "unknown",
                },
            },
        );
    }
}
