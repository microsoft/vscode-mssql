/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncLocalStorage } from "async_hooks";
import * as mssql from "vscode-mssql";
import * as vscode from "vscode";
import { RequestType } from "vscode-languageclient";
import { Disposable } from "extension-toolkit/base";
import { sendActionEvent } from "extension-toolkit/vscode";
import ConnectionManager from "../controllers/connectionManager";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { IConnectionProfile } from "../models/interfaces";
import { logger } from "../models/logger";
import { QueryCancelRequest } from "../models/contracts/queryCancel";
import { ScriptOperation } from "../models/contracts/scripting/scriptingRequest";
import { ScriptingService } from "../scripting/scriptingService";
import { ILogger } from "../sharedInterfaces/logger";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { uuid } from "../utils/utils";
import {
    AccessTokenRejection,
    SharedConnectionsAuthenticationProvider,
} from "./sharedConnectionsAuthenticationProvider";
import { ConnectionSharingError, ConnectionSharingErrorCode } from "./connectionSharingService";

/**
 * The API's methods. Each is also exposed as an `mssql.sharedConnections.<method>` command, for
 * callers that use commands rather than the extension's exports. A command takes the same
 * arguments as its method, access token first, so it's checked the same way.
 */
const COMMAND_METHODS = [
    "getActiveEditorConnectionId",
    "getActiveDatabase",
    "getDatabaseForConnectionId",
    "connect",
    "disconnect",
    "isConnected",
    "executeSimpleQuery",
    "cancelQuery",
    "getServerInfo",
    "listDatabases",
    "scriptObject",
    "getConnectionString",
] as const satisfies readonly (keyof mssql.ISharedConnectionsService)[];

type SharedConnectionsMethod = (typeof COMMAND_METHODS)[number];

/**
 * Returns the version of the shared connections API that a caller asked for through
 * `IExtension.getSharedConnectionsApi`. Only version 1 exists so far; a later breaking change
 * would add version 2 here alongside it.
 *
 * Callers get a frozen object with only the public members, not the service itself: its private
 * fields are reachable at runtime, and they include the authentication provider, which issues
 * tokens without asking the user.
 */
export function getSharedConnectionsApi(
    service: SharedConnectionsService,
    version: number,
): mssql.ISharedConnectionsService {
    if (version === 1) {
        const api: Record<string, unknown> = {
            authenticationProviderId: service.authenticationProviderId,
            onDidChangeActiveEditorConnection: service.onDidChangeActiveEditorConnection,
        };
        for (const method of COMMAND_METHODS) {
            api[method] = (service[method] as (...args: unknown[]) => unknown).bind(service);
        }
        return Object.freeze(api) as unknown as mssql.ISharedConnectionsService;
    }
    throw new Error(
        `Version ${version} of the shared connections API isn't available in this version of the MSSQL extension, which supports version 1.`,
    );
}

/** What a call's telemetry reports about it, filled in as the call resolves its connection. */
interface CallDetails {
    authenticationType?: string;
    serverInfo?: mssql.IServerInfo;
    tokenRejection?: AccessTokenRejection;
}

/**
 * Shares mssql connections with extensions that hold a session from
 * {@link SharedConnectionsAuthenticationProvider}. Each connection URI is tied to the session that
 * opened it, so callers can't act on URIs they didn't create, such as a query editor's.
 */
export class SharedConnectionsService
    extends Disposable
    implements mssql.ISharedConnectionsService
{
    public readonly authenticationProviderId = Constants.sharedConnectionsAuthenticationProviderId;
    private readonly _logger: ILogger;
    /** The ID of the session that opened each connection URI. */
    private readonly _connectionSessionIds = new Map<string, string>();
    /** Set while a call made through a command runs, so its telemetry can say so. */
    private readonly _commandCalls = new AsyncLocalStorage<boolean>();
    private readonly _onDidChangeActiveEditorConnection = this._register(
        new vscode.EventEmitter<void>(),
    );
    /** The active editor's connection and database when last checked, so only real changes fire. */
    private _activeEditorConnectionKey: string | undefined;

    /**
     * Fires when the active editor's connection or database changes. It carries no details, so
     * subscribing needs no access token; each subscription is reported in telemetry.
     */
    public readonly onDidChangeActiveEditorConnection: vscode.Event<void> = (
        listener,
        thisArgs,
        disposables,
    ) => {
        sendActionEvent(TelemetryViews.Connection, TelemetryActions.SharedConnectionsApiCalled, {
            additionalProps: {
                method: "onDidChangeActiveEditorConnection",
                surface: "api",
                outcome: "succeeded",
            },
        });
        return this._onDidChangeActiveEditorConnection.event(listener, thisArgs, disposables);
    };

    constructor(
        private readonly _authenticationProvider: SharedConnectionsAuthenticationProvider,
        private readonly _client: SqlToolsServiceClient,
        private readonly _connectionManager: ConnectionManager,
        private readonly _scriptingService: ScriptingService,
    ) {
        super();
        this._logger = logger.withPrefix("SharedConnectionsService");
        this._register(
            this._authenticationProvider.onDidChangeSessions((event) => {
                for (const session of event.removed ?? []) {
                    this.disconnectSession(session.id);
                }
            }),
        );
        // The active editor's connection or database can change by switching editors, connecting or
        // disconnecting, changing database with the picker (a reconnect), or running `USE`.
        const checkActiveEditorConnection = () => this.checkActiveEditorConnection();
        this._register(vscode.window.onDidChangeActiveTextEditor(checkActiveEditorConnection));
        this._register(this._connectionManager.onConnectionsChanged(checkActiveEditorConnection));
        this._register(
            this._connectionManager.onDidChangeDatabaseContext(checkActiveEditorConnection),
        );
        this._activeEditorConnectionKey = this.getActiveEditorConnectionKey();

        for (const method of COMMAND_METHODS) {
            const handler = this[method] as (...args: unknown[]) => Promise<unknown>;
            this._register(
                vscode.commands.registerCommand(
                    `${Constants.sharedConnectionsCommandPrefix}${method}`,
                    (...args: unknown[]) =>
                        this._commandCalls.run(true, () => handler.apply(this, args)),
                ),
            );
        }
    }

    public getActiveEditorConnectionId(accessToken: string): Promise<string | undefined> {
        return this.track("getActiveEditorConnectionId", async (call) => {
            await this.validateAccessToken(call, accessToken);
            return this.getActiveEditorConnection(call)?.id;
        });
    }

    public getActiveDatabase(accessToken: string): Promise<string | undefined> {
        return this.track("getActiveDatabase", async (call) => {
            await this.validateAccessToken(call, accessToken);
            return this.getActiveEditorConnection(call)?.database;
        });
    }

    public getDatabaseForConnectionId(
        accessToken: string,
        connectionId: string,
    ): Promise<string | undefined> {
        return this.track("getDatabaseForConnectionId", async (call) => {
            await this.validateAccessToken(call, accessToken);
            const connection = await this.findSavedConnection(connectionId);
            call.authenticationType = connection?.authenticationType;
            return connection?.database;
        });
    }

    public connect(accessToken: string, connectionId: string, database?: string): Promise<string> {
        return this.track("connect", async (call) => {
            const sessionId = await this.validateAccessToken(call, accessToken);
            const connection = await this.getSavedConnection(connectionId);
            call.authenticationType = connection.authenticationType;

            const connectionUri = uuid();
            const connected = await this._connectionManager.connect(
                connectionUri,
                database ? { ...connection, database } : connection,
                { connectionSource: "sharedConnectionsService" },
            );
            if (!connected) {
                throw new ConnectionSharingError(
                    ConnectionSharingErrorCode.CONNECTION_FAILED,
                    LocalizedConstants.ConnectionSharing.failedToEstablishConnectionError(
                        connectionId,
                    ),
                    undefined,
                    connectionId,
                );
            }
            this.describeConnectionUri(call, connectionUri);

            // The session can end while the connection is opening; don't leave an orphaned
            // connection. Only the session matters here: the token may expire during a slow connect.
            if (!(await this._authenticationProvider.isSessionActive(sessionId))) {
                this.closeConnectionInBackground(
                    connectionUri,
                    "Failed to close a connection whose session ended while it was opening.",
                );
                call.tokenRejection = "sessionEnded";
                throw this.invalidAccessTokenError();
            }

            this._connectionSessionIds.set(connectionUri, sessionId);
            return connectionUri;
        });
    }

    public disconnect(accessToken: string, connectionUri: string): Promise<void> {
        return this.track("disconnect", async (call) => {
            await this.validateOwnedConnectionUri(call, accessToken, connectionUri);
            // Keep the ownership until the disconnect succeeds, so a failed one can be retried and
            // is still closed when the session ends.
            await this._connectionManager.disconnect(connectionUri);
            this._connectionSessionIds.delete(connectionUri);
        });
    }

    public isConnected(accessToken: string, connectionUri: string): Promise<boolean> {
        return this.track("isConnected", async (call) => {
            const sessionId = await this.validateAccessToken(call, accessToken);
            const connected =
                this._connectionSessionIds.get(connectionUri) === sessionId &&
                this._connectionManager.isConnected(connectionUri);
            if (connected) {
                this.describeConnectionUri(call, connectionUri);
            }
            return connected;
        });
    }

    public executeSimpleQuery(
        accessToken: string,
        connectionUri: string,
        queryString: string,
    ): Promise<mssql.SimpleExecuteResult> {
        return this.track("executeSimpleQuery", async (call) => {
            await this.validateActiveConnection(call, accessToken, connectionUri);
            return await this._client.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    mssql.SimpleExecuteResult,
                    void
                >("query/simpleexecute"),
                { ownerUri: connectionUri, queryString },
            );
        });
    }

    public cancelQuery(accessToken: string, connectionUri: string): Promise<void> {
        return this.track("cancelQuery", async (call) => {
            await this.validateActiveConnection(call, accessToken, connectionUri);
            await this._client.sendRequest(QueryCancelRequest.type, { ownerUri: connectionUri });
        });
    }

    public getServerInfo(accessToken: string, connectionUri: string): Promise<mssql.IServerInfo> {
        return this.track("getServerInfo", async (call) => {
            await this.validateActiveConnection(call, accessToken, connectionUri);
            return this._connectionManager.getServerInfo(
                this._connectionManager.getConnectionInfoFromUri(connectionUri),
            );
        });
    }

    public listDatabases(accessToken: string, connectionUri: string): Promise<string[]> {
        return this.track("listDatabases", async (call) => {
            await this.validateActiveConnection(call, accessToken, connectionUri);
            return await this._connectionManager.listDatabases(connectionUri);
        });
    }

    public scriptObject(
        accessToken: string,
        connectionUri: string,
        operation: ScriptOperation,
        scriptingObject: mssql.IScriptingObject,
    ): Promise<string | undefined> {
        return this.track("scriptObject", async (call) => {
            await this.validateActiveConnection(call, accessToken, connectionUri);
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
        });
    }

    public getConnectionString(
        accessToken: string,
        connectionId: string,
    ): Promise<string | undefined> {
        return this.track("getConnectionString", async (call) => {
            await this.validateAccessToken(call, accessToken);
            const connection = await this.getSavedConnection(connectionId);
            call.authenticationType = connection.authenticationType;

            return await this._connectionManager.getConnectionString(
                this._connectionManager.createConnectionDetails(connection),
                true, // includePassword
                false, // do not include appName
            );
        });
    }

    private checkActiveEditorConnection(): void {
        const key = this.getActiveEditorConnectionKey();
        if (key !== this._activeEditorConnectionKey) {
            this._activeEditorConnectionKey = key;
            this._onDidChangeActiveEditorConnection.fire();
        }
    }

    /** The active editor's connection ID and database, or undefined when it isn't connected. */
    private getActiveEditorConnectionKey(): string | undefined {
        const uri = vscode.window.activeTextEditor?.document.uri.toString();
        if (!uri || !this._connectionManager.isConnected(uri)) {
            return undefined;
        }
        const connection = this._connectionManager.getConnectionInfoFromUri(
            uri,
        ) as IConnectionProfile;
        return JSON.stringify([connection?.id, connection?.database]);
    }

    /** Runs a call and reports it once it completes, whether it succeeds or fails. */
    private async track<T>(
        method: SharedConnectionsMethod,
        run: (call: CallDetails) => Promise<T>,
    ): Promise<T> {
        const surface = this._commandCalls.getStore() ? "command" : "api";
        const call: CallDetails = {};
        const startTime = performance.now();
        let failure: { error: unknown } | undefined;
        try {
            return await run(call);
        } catch (error) {
            failure = { error };
            throw error;
        } finally {
            this.sendCallTelemetry(method, surface, call, performance.now() - startTime, failure);
        }
    }

    /**
     * Reports a call without anything that identifies the user or their data: no server,
     * database or connection names, IDs or URIs, no query text, and no error messages or stacks.
     * Each value is a fixed string, a server property such as its version, or a number, so VS
     * Code's telemetry cleaning has nothing to redact.
     */
    private sendCallTelemetry(
        method: SharedConnectionsMethod,
        surface: "api" | "command",
        call: CallDetails,
        durationMs: number,
        failure: { error: unknown } | undefined,
    ): void {
        const error = failure?.error;
        sendActionEvent(TelemetryViews.Connection, TelemetryActions.SharedConnectionsApiCalled, {
            additionalProps: {
                method,
                surface,
                outcome: failure ? "failed" : "succeeded",
                ...(failure && {
                    errorCode: error instanceof ConnectionSharingError ? error.code : "unexpected",
                }),
                // The error's class name helps tell unexpected failures apart; anything that
                // isn't a plain identifier is left out so it can't carry details.
                ...(failure &&
                    !(error instanceof ConnectionSharingError) && {
                        errorName:
                            error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name)
                                ? error.name
                                : "other",
                    }),
                ...(call.tokenRejection && { tokenRejection: call.tokenRejection }),
            },
            additionalMeasurements: { durationMs: Math.round(durationMs) },
            connectionInfo: { authenticationType: call.authenticationType ?? "unknown" },
            ...(call.serverInfo && { serverInfo: call.serverInfo }),
        });
    }

    /** Returns the ID of the session that issued the access token. */
    private async validateAccessToken(call: CallDetails, accessToken: string): Promise<string> {
        const check = await this._authenticationProvider.checkAccessToken(accessToken);
        if ("rejection" in check) {
            call.tokenRejection = check.rejection;
            throw this.invalidAccessTokenError();
        }
        return check.sessionId;
    }

    private async validateOwnedConnectionUri(
        call: CallDetails,
        accessToken: string,
        connectionUri: string,
    ): Promise<void> {
        const sessionId = await this.validateAccessToken(call, accessToken);
        if (!connectionUri || this._connectionSessionIds.get(connectionUri) !== sessionId) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                LocalizedConstants.ConnectionSharing.invalidConnectionUri,
            );
        }
        this.describeConnectionUri(call, connectionUri);
    }

    private async validateActiveConnection(
        call: CallDetails,
        accessToken: string,
        connectionUri: string,
    ): Promise<void> {
        await this.validateOwnedConnectionUri(call, accessToken, connectionUri);
        if (!this._connectionManager.isConnected(connectionUri)) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                LocalizedConstants.ConnectionSharing.connectionNotActive,
            );
        }
    }

    /** Records the authentication type and server details of a connection the call works on. */
    private describeConnectionUri(call: CallDetails, connectionUri: string): void {
        const connectionInfo = this._connectionManager.getConnectionInfoFromUri(connectionUri);
        if (!connectionInfo) {
            return;
        }
        call.authenticationType = connectionInfo.authenticationType;
        call.serverInfo = this._connectionManager.getServerInfo(connectionInfo);
    }

    private getActiveEditorConnection(call: CallDetails): IConnectionProfile | undefined {
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
        this.describeConnectionUri(call, activeEditorUri);
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
            this.closeConnectionInBackground(
                connectionUri,
                "Failed to close a connection after its session ended.",
            );
        }
    }

    /** Closes a connection without waiting, logging a failure rather than leaving it unhandled. */
    private closeConnectionInBackground(connectionUri: string, failureMessage: string): void {
        void Promise.resolve(this._connectionManager.disconnect(connectionUri)).catch((error) => {
            this._logger.error(failureMessage, error);
        });
    }

    private invalidAccessTokenError(): ConnectionSharingError {
        return new ConnectionSharingError(
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
            LocalizedConstants.ConnectionSharing.invalidAccessToken,
        );
    }
}
