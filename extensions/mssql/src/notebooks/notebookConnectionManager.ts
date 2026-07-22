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
import {
    ConnectionRequest,
    ConnectParams,
    ConnectionCompleteParams,
    DisconnectRequest,
    DisconnectParams,
} from "../models/contracts/connection";
import { generateQueryUri } from "../models/utils";
import * as LocalizedConstants from "../constants/locConstants";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions, ActivityStatus } from "../sharedInterfaces/telemetry";
import { ILogger } from "../sharedInterfaces/logger";
import {
    HeadlessQueryExecutor,
    HeadlessQueryResult,
} from "../queryExecution/headlessQueryExecutor";

/**
 * Manages the active database connection for a notebook.
 * One connection per notebook — each notebook maintains its own isolated session.
 *
 * NOTE: The MSSQL extension's connectionSharing.getActiveEditorConnectionId()
 * uses vscode.window.activeTextEditor, which is undefined for notebook editors.
 * We cannot auto-sync with the MSSQL UI. Connection changes must be explicit:
 *   - %%connect magic command
 *   - "New SQL Notebook" from Object Explorer (connectWith)
 *   - First cell execution (prompts the user)
 *
 * NOTE: The MSSQL extension's SqlDocumentService auto-connects any newly opened
 * SQL document to _lastActiveConnectionInfo. This means notebook cells may show
 * a different connection in the MSSQL code lens than what this NotebookConnectionManager
 * actually uses for query execution. Our connection (under an adhoc URI) is the
 * authoritative one for SQL execution.
 */
/**
 * How long to wait for STS to report `connection/complete` for a cell's
 * IntelliSense registration before treating the attempt as failed so a
 * later trigger can retry it.
 */
const CELL_CONNECT_COMPLETE_TIMEOUT_MS = 30000;

export class NotebookConnectionManager implements vscode.Disposable {
    private connectionUri: string | undefined;
    private connectionInfo: IConnectionInfo | undefined;
    private connectionLabel: string = "";
    private log: ILogger;
    private readonly queryExecutor: HeadlessQueryExecutor;

    /**
     * Cell document URIs already registered with STS for IntelliSense against
     * the current connectionUri. Cleared whenever the connection changes so
     * cells get re-registered against the new connection.
     *
     * Without this, every executeCell re-fires a `connection/connect` RPC per
     * cell, and those serialize ahead of `query/executeString` on the STS
     * JSON-RPC channel — adding seconds of latency on slow connections.
     */
    private registeredCellUris: Set<string> = new Set();

    private connectionGeneration = 0;

    /**
     * Saved reconnection context from notebook metadata.
     * Used to restore the database when the user picks a server-level
     * profile (no explicit database) during reconnection.
     */
    private _savedServer: string | undefined;
    private _savedDatabase: string | undefined;

    constructor(
        private connectionMgr: ConnectionManager,
        private connectionSharingService: ConnectionSharingService,
        log: ILogger,
        client?: SqlToolsServiceClient,
        notificationHandler?: QueryNotificationHandler,
    ) {
        this.log = log;
        this.queryExecutor = new HeadlessQueryExecutor(
            client ?? SqlToolsServiceClient.instance,
            notificationHandler ?? QueryNotificationHandler.instance,
            log,
        );
    }

    /**
     * Set the reconnection context from persisted notebook metadata.
     * Called when recreating the manager after a VS Code restart so that
     * promptAndConnect() can restore the correct database instead of
     * defaulting to master.
     */
    setReconnectionContext(server: string, database: string): void {
        this._savedServer = server;
        this._savedDatabase = database;
    }

    /**
     * Get the actual database name from the connection manager.
     * After connect() succeeds, STS populates the credentials with the real
     * database name from the server's ConnectionCompleteParams.connectionSummary.
     */
    private getActualDatabase(uri: string): string | undefined {
        const info = this.connectionMgr.getConnectionInfoFromUri(uri);
        return info?.database;
    }

    /**
     * Connect to a server using mssql's internal ConnectionManager.
     * Returns the connection URI on success.
     */
    private async connectInternal(connectionInfo: IConnectionInfo): Promise<string> {
        const uri = generateQueryUri().toString();
        this.log.debug(
            `[connectInternal] begin adhocUri=${uri} ` +
                `server=${connectionInfo.server} database=${connectionInfo.database ?? "(default)"}`,
        );
        const started = Date.now();
        let success: boolean;
        try {
            success = await this.connectionMgr.connect(uri, connectionInfo, {
                connectionSource: "sqlNotebooks",
            });
        } catch (err: any) {
            this.log.error(
                `[connectInternal] connect threw after ${Date.now() - started}ms ` +
                    `uri=${uri} msg=${err?.message ?? "(no message)"}`,
            );
            throw err;
        }
        this.log.debug(
            `[connectInternal] connect returned success=${success} ` +
                `after ${Date.now() - started}ms uri=${uri}`,
        );
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
        this.log.debug(
            `[ensureConnection] begin currentUri=${this.connectionUri ?? "none"} ` +
                `hasStoredInfo=${!!this.connectionInfo}`,
        );
        if (this.connectionUri) {
            const alive = this.connectionSharingService.isConnected(this.connectionUri);
            this.log.debug(`[ensureConnection] existing uri alive=${alive}`);
            if (alive) {
                return this.connectionUri;
            }
            // Connection went stale
            this.log.info(`[ensureConnection] Connection stale, clearing: ${this.connectionUri}`);
            this.connectionUri = undefined;
            this.connectionLabel = "";
            this.invalidateCellRegistrations();
        }

        // Try reconnecting with stored connection info (within-session stale connection)
        if (this.connectionInfo) {
            this.log.info("[ensureConnection] Attempting reconnect with stored connection info");
            try {
                const uri = await this.connectInternal(this.connectionInfo);
                this.connectionUri = uri;
                this.invalidateCellRegistrations();
                const actualDb = this.getActualDatabase(uri);
                this.connectionLabel = formatConnectionLabel(this.connectionInfo.server, actualDb);
                return uri;
            } catch (err: any) {
                this.log.warn(`[ensureConnection] Reconnect failed: ${err.message}, will prompt`);
            }
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
            let connectionInfo =
                await this.connectionMgr.connectionUI.promptForConnection(pickListItems);
            if (!connectionInfo) {
                throw new Error(LocalizedConstants.Notebooks.noConnectionSelected);
            }

            // If the notebook has a saved database context and the user picked a
            // server-level profile (no explicit database), restore the saved database
            // so the notebook reconnects to its original database instead of master.
            const savedDb = this.connectionInfo?.database || this._savedDatabase;
            const savedServer = this.connectionInfo?.server || this._savedServer;
            if (
                savedDb &&
                !connectionInfo.database &&
                savedServer?.toLowerCase() === connectionInfo.server.toLowerCase()
            ) {
                this.log.info(`[promptAndConnect] Restoring saved database context: ${savedDb}`);
                connectionInfo = { ...connectionInfo, database: savedDb };
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
            this.invalidateCellRegistrations();
            activity.end(ActivityStatus.Succeeded);
            return uri;
        } catch (err) {
            activity.endFailed(new Error("Connection prompt failed or was cancelled"));
            throw err;
        }
    }

    /**
     * Connect with a specific connection profile (from Object Explorer context menu).
     * The caller sets `connectionInfo.database` to the OE node's database.
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

            const actualDb = this.getActualDatabase(uri);
            this.log.info(`[connectWith] Connected to database: ${actualDb}`);

            this.connectionUri = uri;
            this.connectionInfo = { ...connectionInfo, database: actualDb || database };
            this.connectionLabel = formatConnectionLabel(server, actualDb || database);
            this.invalidateCellRegistrations();
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
        this.invalidateCellRegistrations();
    }

    getCurrentDatabase(): string {
        return this.connectionInfo?.database || "";
    }

    async executeQueryString(
        sql: string,
        cancellationToken?: vscode.CancellationToken,
    ): Promise<HeadlessQueryResult> {
        if (!this.connectionUri) {
            this.log.warn(`[executeQueryString] no active connection`);
            throw new Error(LocalizedConstants.Notebooks.noActiveConnection);
        }
        const alive = this.connectionSharingService.isConnected(this.connectionUri);
        this.log.debug(
            `[executeQueryString] dispatch uri=${this.connectionUri} ` +
                `aliveAtDispatch=${alive} sqlLen=${sql.length}`,
        );
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
        // Release (not just forget) cell registrations: each registered cell
        // holds its own STS-side connection that nothing else ever closes.
        this.releaseCellRegistrations();
    }

    /**
     * Disconnect a specific URI from the connection sharing service without
     * clearing the manager's current state. Used to clean up a previous
     * connection after a new one has been established.
     */
    disconnectUri(uri: string): void {
        this.log.info(`[disconnectUri] URI=${uri}`);
        this.connectionSharingService.disconnect(uri);
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
     * Reset the IntelliSense cell registration cache. Called whenever the
     * connection identity changes so cells get re-registered against the new
     * connection. Bumping the generation lets in-flight cell registrations
     * detect that they're stale and skip writing back into the cache.
     */
    private invalidateCellRegistrations(): void {
        this.connectionGeneration++;
        this.registeredCellUris.clear();
    }

    /**
     * Register a cell document URI with STS so IntelliSense
     * (completions, hover, diagnostics) works for notebook cells.
     *
     * Sends a `connection/connect` request to STS with the cell's
     * document URI as ownerUri and the notebook's connection details.
     * STS shares metadata caches across connections with the same
     * server/database/auth, so this doesn't cause redundant queries.
     *
     * Memoized per connection: subsequent calls for the same cell URI
     * are no-ops until the connection changes. This prevents redundant
     * connect RPCs from queuing ahead of query execution on the STS
     * JSON-RPC channel when re-running cells in a notebook.
     */
    async connectCellForIntellisense(cellDocumentUri: string): Promise<void> {
        if (!this.connectionInfo) {
            this.log.debug(
                `[connectCellForIntellisense] Skipped (no connectionInfo) cell=${cellDocumentUri}`,
            );
            return;
        }

        if (this.registeredCellUris.has(cellDocumentUri)) {
            return;
        }

        const generation = this.connectionGeneration;

        // Prefer the live credentials that STS validated for the notebook's execution
        // connection — they carry any refreshed auth token and the actual database —
        // over the stored profile, so the cell binds to the same database the
        // notebook executes against.
        const sourceInfo =
            (this.connectionUri
                ? this.connectionMgr.getConnectionInfoFromUri(this.connectionUri)
                : undefined) ?? this.connectionInfo;

        let connectionDetails: ConnectionDetails;
        try {
            connectionDetails = this.connectionMgr.createConnectionDetails(sourceInfo);
        } catch (err: any) {
            this.log.warn(
                `[connectCellForIntellisense] createConnectionDetails failed: ${err.message} cell=${cellDocumentUri}`,
            );
            return;
        }

        let cellUriScheme = "unknown";
        try {
            cellUriScheme = vscode.Uri.parse(cellDocumentUri).scheme;
        } catch {
            // ignore parse errors
        }
        const authType = connectionDetails.options?.authenticationType ?? "unknown";
        this.log.debug(
            `[connectCellForIntellisense] Sending connect request scheme=${cellUriScheme} server=${sourceInfo.server} database=${sourceInfo.database || "(default)"} auth=${authType} cell=${cellDocumentUri}`,
        );

        this.registeredCellUris.add(cellDocumentUri);

        // The connect request only acknowledges that a connection attempt STARTED;
        // the actual outcome arrives via the connection/complete notification.
        // Register for it before sending the request so the result isn't missed.
        const completePromise = this.connectionMgr.expectConnectionComplete(cellDocumentUri);

        try {
            const params: ConnectParams = {
                ownerUri: cellDocumentUri,
                connection: connectionDetails,
            };

            const result = await this.connectionMgr.sendRequest(ConnectionRequest.type, params);

            if (result !== true) {
                this.connectionMgr.cancelConnectionCompleteExpectation(
                    cellDocumentUri,
                    completePromise,
                );
                if (generation === this.connectionGeneration) {
                    this.registeredCellUris.delete(cellDocumentUri);
                }
                this.log.warn(
                    `[connectCellForIntellisense] STS did not accept connect request (result=${String(result)}) cell=${cellDocumentUri}`,
                );
                return;
            }

            const completeParams = await this.waitForCellConnectionComplete(
                cellDocumentUri,
                completePromise,
            );

            if (generation !== this.connectionGeneration) {
                this.log.debug(
                    `[connectCellForIntellisense] connection changed mid-request (gen ${generation} → ${this.connectionGeneration}); dropping stale registration cell=${cellDocumentUri}`,
                );
                if (completeParams?.connectionId) {
                    // The stale connect actually landed in STS after this cell's
                    // registration was released — disconnect it so it doesn't
                    // linger untracked (a released cell URI is never retried
                    // under this generation's bookkeeping).
                    this.disconnectCellUri(cellDocumentUri);
                }
                return;
            }

            if (!completeParams?.connectionId) {
                // Connection failed or timed out — deregister so the next
                // IntelliSense trigger (cell execution, connection change,
                // cell document open) retries instead of silently leaving the
                // cell with keyword-only completions.
                this.registeredCellUris.delete(cellDocumentUri);
                this.log.warn(
                    `[connectCellForIntellisense] STS connection did not complete ` +
                        `(${completeParams ? `error=${completeParams.errorMessage ?? completeParams.messages ?? "unknown"}` : "timed out"}) cell=${cellDocumentUri}`,
                );
                return;
            }

            this.log.debug(
                `[connectCellForIntellisense] STS connection complete connectionId=${completeParams.connectionId} cell=${cellDocumentUri}`,
            );
        } catch (err: any) {
            this.connectionMgr.cancelConnectionCompleteExpectation(
                cellDocumentUri,
                completePromise,
            );
            if (generation === this.connectionGeneration) {
                this.registeredCellUris.delete(cellDocumentUri);
            }
            this.log.warn(
                `[connectCellForIntellisense] sendRequest failed: ${err.message} cell=${cellDocumentUri}`,
            );
        }
    }

    /**
     * Awaits the connection/complete notification for a cell registration,
     * resolving undefined if it doesn't arrive within the timeout.
     */
    private async waitForCellConnectionComplete(
        cellDocumentUri: string,
        completePromise: Promise<ConnectionCompleteParams>,
    ): Promise<ConnectionCompleteParams | undefined> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
                this.connectionMgr.cancelConnectionCompleteExpectation(
                    cellDocumentUri,
                    completePromise,
                );
                resolve(undefined);
            }, CELL_CONNECT_COMPLETE_TIMEOUT_MS);
        });
        try {
            return await Promise.race([completePromise, timeoutPromise]);
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }

    /**
     * Releases all current cell IntelliSense registrations: clears the
     * memoization (so future registrations re-connect) and best-effort
     * disconnects the previously registered cell URIs from STS.
     *
     * Called when the notebook's cell URIs change wholesale — i.e. when an
     * untitled notebook is saved to disk and every cell document is re-created
     * under a file-based URI. This mirrors the query editor's save flow
     * (ConnectionManager.transferConnectionToFile), which connects the new URI
     * and disconnects the old one.
     */
    releaseCellRegistrations(): void {
        const staleUris = [...this.registeredCellUris];
        this.invalidateCellRegistrations();

        for (const uri of staleUris) {
            this.disconnectCellUri(uri);
        }
    }

    /**
     * Best-effort disconnect of a single cell's STS-side IntelliSense
     * connection (fire-and-forget with logging).
     */
    private disconnectCellUri(uri: string): void {
        const params: DisconnectParams = { ownerUri: uri };
        void this.connectionMgr.sendRequest(DisconnectRequest.type, params).then(
            (disconnected) =>
                this.log.debug(
                    `[disconnectCellUri] disconnect result=${String(disconnected)} cell=${uri}`,
                ),
            (err: any) =>
                this.log.warn(
                    `[disconnectCellUri] disconnect failed: ${err?.message ?? err} cell=${uri}`,
                ),
        );
    }

    dispose(): void {
        this.disconnect();
    }
}

function formatConnectionLabel(server: string, database: string): string {
    return `${server || "unknown"} / ${database || "master"}`;
}
