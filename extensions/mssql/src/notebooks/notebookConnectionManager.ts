/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { IConnectionInfo, ConnectionDetails } from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import { ConnectionSharingService } from "../connectionSharing/connectionSharingService";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { QueryNotificationHandler } from "../controllers/queryNotificationHandler";
import { ConnectionRequest, ConnectParams } from "../models/contracts/connection";
import { generateQueryUri } from "../models/utils";
import * as LocalizedConstants from "../constants/locConstants";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions, ActivityStatus } from "../sharedInterfaces/telemetry";
import { NotebookQueryExecutor, NotebookQueryResult } from "./notebookQueryExecutor";

/**
 * Manages the active database connection for a notebook.
 * One connection per notebook — each notebook maintains its own isolated session.
 *
 * NOTE: The MSSQL extension's connectionSharing.getActiveEditorConnectionId()
 * uses vscode.window.activeTextEditor, which is undefined for notebook editors.
 * We cannot auto-sync with the MSSQL UI. Connection changes must be explicit:
 *   - %%connect magic command
 *   - "Create SQL Notebook" from Object Explorer (connectWith)
 *   - First cell execution (prompts the user)
 *
 * NOTE: The MSSQL extension's SqlDocumentService auto-connects any newly opened
 * SQL document to _lastActiveConnectionInfo. This means notebook cells may show
 * a different connection in the MSSQL code lens than what this NotebookConnectionManager
 * actually uses for query execution. Our connection (under an adhoc URI) is the
 * authoritative one for SQL execution.
 */
export class NotebookConnectionManager implements vscode.Disposable {
    private connectionUri: string | undefined;
    private connectionInfo: IConnectionInfo | undefined;
    private connectionLabel: string = "";
    private log: vscode.LogOutputChannel;
    private readonly queryExecutor: NotebookQueryExecutor;

    constructor(
        private connectionMgr: ConnectionManager,
        private connectionSharingService: ConnectionSharingService,
        log: vscode.LogOutputChannel,
        client?: SqlToolsServiceClient,
        notificationHandler?: QueryNotificationHandler,
    ) {
        this.log = log;
        this.queryExecutor = new NotebookQueryExecutor(
            client ?? SqlToolsServiceClient.instance,
            notificationHandler ?? QueryNotificationHandler.instance,
        );
    }

    /**
     * Get the actual database name from the connection manager.
     * After connect() succeeds, STS populates the credentials with the real
     * database name from the server's ConnectionCompleteParams.connectionSummary.
     */
    private getActualDatabase(uri: string): string {
        const info = this.connectionMgr.getConnectionInfoFromUri(uri);
        return info?.database || "(unknown)";
    }

    /**
     * Connect to a server using mssql's internal ConnectionManager.
     * Returns the connection URI on success.
     */
    private async connectInternal(connectionInfo: IConnectionInfo): Promise<string> {
        const uri = generateQueryUri().toString();
        const success = await this.connectionMgr.connect(uri, connectionInfo, {
            connectionSource: "sqlNotebooks",
        });
        if (!success) {
            throw new Error(LocalizedConstants.Notebooks.connectionFailed);
        }
        return uri;
    }

    /**
     * Ensure we have a live connection. Reuses the existing connection if alive,
     * otherwise prompts the user to pick one.
     */
    async ensureConnection(): Promise<string> {
        if (this.connectionUri) {
            if (this.connectionSharingService.isConnected(this.connectionUri)) {
                return this.connectionUri;
            }
            // Connection went stale
            this.log.info(`[ensureConnection] Connection stale, clearing: ${this.connectionUri}`);
            this.connectionUri = undefined;
            this.connectionLabel = "";
        }

        // No alive connection — prompt the user
        this.log.info("[ensureConnection] No connection, prompting user");
        return this.promptAndConnect();
    }

    /**
     * Prompt the user to pick a connection via the MSSQL extension's connection dialog.
     * Used by %%connect and as fallback when no connection exists.
     */
    async promptAndConnect(): Promise<string> {
        const activity = startActivity(
            TelemetryViews.SqlNotebooks,
            TelemetryActions.NotebookConnect,
            undefined,
            { method: "prompt" },
        );
        try {
            const pickListItems = await this.connectionMgr.connectionStore.getPickListItems();
            const connectionInfo =
                await this.connectionMgr.connectionUI.promptForConnection(pickListItems);
            if (!connectionInfo) {
                throw new Error(LocalizedConstants.Notebooks.noConnectionSelected);
            }

            this.log.info(
                `[promptAndConnect] server=${connectionInfo.server}, database=${connectionInfo.database}`,
            );
            const uri = await this.connectInternal(connectionInfo);
            this.log.info(`[promptAndConnect] connect() → URI=${uri}`);

            const actualDb = this.getActualDatabase(uri);
            this.log.info(`[promptAndConnect] Actual DB: ${actualDb}`);
            this.connectionLabel = formatConnectionLabel(connectionInfo.server, actualDb);

            this.connectionUri = uri;
            this.connectionInfo = connectionInfo;
            activity.end(ActivityStatus.Succeeded);
            return uri;
        } catch (err) {
            activity.endFailed(new Error("Connection prompt failed or was cancelled"));
            throw err;
        }
    }

    /**
     * Connect with a specific connection profile (from Object Explorer context menu).
     * After connecting, verifies the database from the STS connection info and
     * reconnects with the correct database if there's a mismatch.
     */
    async connectWith(connectionInfo: IConnectionInfo): Promise<string> {
        const activity = startActivity(
            TelemetryViews.SqlNotebooks,
            TelemetryActions.NotebookConnect,
            undefined,
            { method: "objectExplorer" },
        );
        try {
            const server = connectionInfo.server;
            const database = connectionInfo.database;
            this.log.info(`[connectWith] server=${server}, database=${database}`);

            const uri = await this.connectInternal(connectionInfo);
            this.log.info(`[connectWith] connect() → URI=${uri}`);

            // Check the actual database from the connection info that STS populated.
            let actualDb = this.getActualDatabase(uri);
            this.log.info(
                `[connectWith] Actual DB: ${actualDb}, Expected: ${database || "(none)"}`,
            );

            if (
                database &&
                actualDb.toLowerCase() !== database.toLowerCase() &&
                // getActualDatabase() returns "(unknown)" when STS hasn't populated the
                // connection info yet. In that case we can't confirm a mismatch, so skip
                // the reconnect and use the database the caller requested.
                actualDb !== "(unknown)"
            ) {
                // Wrong database — disconnect and reconnect with correct DB
                this.log.info(`[connectWith] Database mismatch! Reconnecting with [${database}]`);
                this.connectionSharingService.disconnect(uri);
                const fixedInfo = { ...connectionInfo, database };
                const newUri = await this.connectInternal(fixedInfo);
                actualDb = this.getActualDatabase(newUri);
                this.log.info(`[connectWith] After reconnect: ${actualDb}, URI=${newUri}`);
                this.connectionUri = newUri;
                this.connectionInfo = { ...connectionInfo, database: actualDb };
                this.connectionLabel = formatConnectionLabel(server, actualDb);
                activity.end(ActivityStatus.Succeeded);
                return newUri;
            }

            this.connectionUri = uri;
            // If STS hasn't populated the database yet, fall back to the caller's
            // requested database rather than storing "(unknown)".
            const resolvedDb = actualDb !== "(unknown)" ? actualDb : (database ?? actualDb);
            this.connectionInfo = { ...connectionInfo, database: resolvedDb };
            this.connectionLabel = formatConnectionLabel(server, resolvedDb);
            activity.end(ActivityStatus.Succeeded);
            return uri;
        } catch (err) {
            activity.endFailed(new Error("Failed to connect with provided connection profile"));
            throw err;
        }
    }

    /**
     * List all databases on the current server.
     */
    async listDatabases(): Promise<string[]> {
        if (!this.connectionUri) {
            throw new Error(LocalizedConstants.Notebooks.noActiveConnection);
        }
        return this.connectionMgr.listDatabases(this.connectionUri);
    }

    /**
     * Switch the notebook's database context by disconnecting and reconnecting
     * with the new database. SimpleExecuteRequest doesn't persist USE across
     * calls, so a full reconnect is required (same pattern as MSSQL copilot tools).
     */
    async changeDatabase(database: string): Promise<void> {
        if (!this.connectionInfo) {
            throw new Error(LocalizedConstants.Notebooks.noActiveConnection);
        }
        this.log.info(`[changeDatabase] Switching to [${database}]`);

        sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.NotebookChangeDatabase);

        // Disconnect current connection
        if (this.connectionUri) {
            this.connectionSharingService.disconnect(this.connectionUri);
        }

        // Reconnect with the new database
        const newInfo = { ...this.connectionInfo, database };
        const uri = await this.connectInternal(newInfo);
        this.log.info(`[changeDatabase] Reconnected → URI=${uri}`);

        // Get the actual database name from the connection info that STS populated
        const actualDb = this.getActualDatabase(uri);
        this.log.info(`[changeDatabase] Verified: ${actualDb}`);

        this.connectionUri = uri;
        this.connectionInfo = newInfo;
        this.connectionLabel = formatConnectionLabel(newInfo.server, actualDb);
    }

    /**
     * Get the current database name from the connection label.
     */
    getCurrentDatabase(): string {
        const parts = this.connectionLabel.split(" / ");
        return parts.length > 1 ? parts[1] : "";
    }

    async executeQueryString(
        sql: string,
        cancellationToken?: vscode.CancellationToken,
    ): Promise<NotebookQueryResult> {
        if (!this.connectionUri) {
            throw new Error(LocalizedConstants.Notebooks.noActiveConnection);
        }
        return this.queryExecutor.execute(this.connectionUri, sql, cancellationToken);
    }

    isConnected(): boolean {
        if (!this.connectionUri) {
            return false;
        }
        return this.connectionSharingService.isConnected(this.connectionUri);
    }

    disconnect(): void {
        this.log.info(`[disconnect] URI=${this.connectionUri ?? "none"}`);
        if (this.connectionUri) {
            sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.NotebookDisconnect);
            this.connectionSharingService.disconnect(this.connectionUri);
        }
        this.connectionUri = undefined;
        this.connectionInfo = undefined;
        this.connectionLabel = "";
    }

    getConnectionLabel(): string {
        return this.connectionLabel || LocalizedConstants.Notebooks.notConnected;
    }

    getConnectionInfo(): IConnectionInfo | undefined {
        return this.connectionInfo;
    }

    getConnectionUri(): string | undefined {
        return this.connectionUri;
    }

    /**
     * Register a cell document URI with STS so IntelliSense
     * (completions, hover, diagnostics) works for notebook cells.
     *
     * Sends a `connection/connect` request to STS with the cell's
     * document URI as ownerUri and the notebook's connection details.
     * STS shares metadata caches across connections with the same
     * server/database/auth, so this doesn't cause redundant queries.
     */
    async connectCellForIntellisense(cellDocumentUri: string): Promise<void> {
        if (!this.connectionInfo) {
            return;
        }

        let connectionDetails: ConnectionDetails;
        try {
            connectionDetails = this.connectionMgr.createConnectionDetails(this.connectionInfo);
        } catch (err: any) {
            this.log.warn(
                `[connectCellForIntellisense] createConnectionDetails failed: ${err.message}`,
            );
            return;
        }

        try {
            const params: ConnectParams = {
                ownerUri: cellDocumentUri,
                connection: connectionDetails,
            };

            await this.connectionMgr.sendRequest(ConnectionRequest.type, params);

            this.log.info(`[connectCellForIntellisense] Connected cell: ${cellDocumentUri}`);
        } catch (err: any) {
            this.log.warn(`[connectCellForIntellisense] sendRequest failed: ${err.message}`);
        }
    }

    dispose(): void {
        this.disconnect();
    }
}

function formatConnectionLabel(server: string, database: string): string {
    return `${server || "unknown"} / ${database || "master"}`;
}
