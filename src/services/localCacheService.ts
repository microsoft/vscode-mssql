/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as crypto from "crypto";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import ConnectionManager from "../controllers/connectionManager";
import { ScriptingService } from "../scripting/scriptingService";
import { IConnectionInfo, SimpleExecuteResult } from "vscode-mssql";
import { ScriptOperation } from "../models/contracts/scripting/scriptingRequest";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { RequestType } from "vscode-languageclient";

/**
 * Metadata for a cached database object
 */
export interface CachedObjectMetadata {
    type: string;
    lastModified: string;
    filePath: string;
    schema: string;
    name: string;
}

/**
 * Cache metadata structure stored in cache-metadata.json
 */
export interface CacheMetadata {
    lastCacheUpdate: string;
    connectionHash: string;
    server: string;
    database: string;
    objects: Record<string, CachedObjectMetadata>;
}

/**
 * Database object information from sys.objects
 */
interface DatabaseObject {
    schema: string;
    name: string;
    type: string;
    modifyDate: string;
}

/**
 * Service for caching database objects to local storage
 */
/**
 * Information about an active refresh timer
 */
interface RefreshTimerInfo {
    timerId: NodeJS.Timeout;
    ownerUri: string; // The original queryable URI (e.g., untitled:Untitled-1)
    cacheOwnerUri: string; // Dedicated URI for cache operations (e.g., vscode-mssql-cache://...)
    credentials: IConnectionInfo;
    isRefreshing: boolean;
}

export class LocalCacheService implements vscode.Disposable {
    private _client: SqlToolsServiceClient;
    private _scriptingService: ScriptingService;
    private _globalStorageUri: vscode.Uri;
    private _cacheBasePath: vscode.Uri;
    private _isEnabled: boolean = true;
    private _autoRefreshEnabled: boolean = true;
    private _autoRefreshIntervalMinutes: number = 15;

    // Map of connection hash to refresh timer info
    private _refreshTimers: Map<string, RefreshTimerInfo> = new Map();

    // Event emitter for cache updates
    private _onCacheUpdated: vscode.EventEmitter<IConnectionInfo> =
        new vscode.EventEmitter<IConnectionInfo>();
    public readonly onCacheUpdated: vscode.Event<IConnectionInfo> = this._onCacheUpdated.event;

    constructor(
        private _connectionManager: ConnectionManager,
        private _context: vscode.ExtensionContext,
    ) {
        this._client = this._connectionManager.client;
        this._scriptingService = new ScriptingService(this._connectionManager);
        this._globalStorageUri = this._context.globalStorageUri;
        this._cacheBasePath = vscode.Uri.joinPath(this._globalStorageUri, "LocalScriptCache");

        // Read configuration
        this.updateConfiguration();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("mssql.localCache")) {
                this.updateConfiguration();
                this.restartAllTimers();
            }
        });

        // Listen for connection changes to stop timers when connections are closed
        this._connectionManager.onConnectionsChanged(() => {
            this.cleanupDisconnectedTimers();
        });
    }

    private updateConfiguration(): void {
        const config = vscode.workspace.getConfiguration("mssql.localCache");
        this._isEnabled = config.get<boolean>("enabled", true);
        this._autoRefreshEnabled = config.get<boolean>("autoRefreshEnabled", true);
        this._autoRefreshIntervalMinutes = config.get<number>("autoRefreshIntervalMinutes", 15);

        // Validate interval
        if (this._autoRefreshIntervalMinutes < 1) {
            this._autoRefreshIntervalMinutes = 1;
        } else if (this._autoRefreshIntervalMinutes > 300) {
            this._autoRefreshIntervalMinutes = 300;
        }

        this._client.logger.info(
            `[LocalCache] Configuration updated - enabled: ${this._isEnabled}, autoRefreshEnabled: ${this._autoRefreshEnabled}, interval: ${this._autoRefreshIntervalMinutes} minutes`,
        );
    }

    /**
     * Dispose of the service and clean up all timers
     */
    public dispose(): void {
        this.stopAllTimers();
    }

    /**
     * Start automatic refresh timer for a connection
     */
    private startRefreshTimer(ownerUri: string, credentials: IConnectionInfo): void {
        console.log(
            `[LocalCache] startRefreshTimer called - enabled: ${this._isEnabled}, autoRefreshEnabled: ${this._autoRefreshEnabled}, interval: ${this._autoRefreshIntervalMinutes} minutes`,
        );

        if (!this._isEnabled) {
            console.log(`[LocalCache] Auto-refresh timer not started - cache is disabled`);
            this._client.logger.info(
                `[LocalCache] Auto-refresh timer not started - cache is disabled`,
            );
            return;
        }

        if (!this._autoRefreshEnabled) {
            console.log(`[LocalCache] Auto-refresh timer not started - auto-refresh is disabled`);
            this._client.logger.info(
                `[LocalCache] Auto-refresh timer not started - auto-refresh is disabled`,
            );
            return;
        }

        const connectionHash = this.generateConnectionHash(credentials);
        console.log(`[LocalCache] Connection hash: ${connectionHash}`);

        // Stop existing timer if any
        this.stopRefreshTimer(connectionHash);

        // Create a dedicated connection URI for cache operations
        // Using vscode-mssql-cache:// scheme to ensure it's unique and queryable
        const cacheOwnerUri = `vscode-mssql-cache://${connectionHash}`;
        console.log(`[LocalCache] Creating dedicated cache connection: ${cacheOwnerUri}`);

        // Create new timer
        const intervalMs = this._autoRefreshIntervalMinutes * 60 * 1000;
        console.log(
            `[LocalCache] Creating auto-refresh timer for ${credentials.server}/${credentials.database} (interval: ${this._autoRefreshIntervalMinutes} minutes = ${intervalMs}ms)`,
        );
        this._client.logger.info(
            `[LocalCache] Creating auto-refresh timer for ${credentials.server}/${credentials.database} (interval: ${this._autoRefreshIntervalMinutes} minutes = ${intervalMs}ms)`,
        );

        const timerId = setInterval(() => {
            console.log(
                `[LocalCache] ⏰ AUTO-REFRESH TIMER FIRED! for ${credentials.server}/${credentials.database}`,
            );
            this._client.logger.info(
                `[LocalCache] Auto-refresh timer triggered for ${credentials.server}/${credentials.database}`,
            );
            try {
                console.log(`[LocalCache] About to call performAutoRefresh...`);
                void this.performAutoRefresh(credentials, connectionHash);
                console.log(`[LocalCache] performAutoRefresh called successfully`);
            } catch (error) {
                console.error(`[LocalCache] ❌ ERROR calling performAutoRefresh:`, error);
                this._client.logger.error(`Error calling performAutoRefresh: ${error}`);
            }
        }, intervalMs);

        this._refreshTimers.set(connectionHash, {
            timerId,
            ownerUri,
            cacheOwnerUri,
            credentials,
            isRefreshing: false,
        });

        console.log(
            `[LocalCache] ✅ Timer created and stored. Total active timers: ${this._refreshTimers.size}`,
        );
        this._client.logger.info(
            `[LocalCache] Started auto-refresh timer for ${credentials.server}/${credentials.database} (interval: ${this._autoRefreshIntervalMinutes} minutes)`,
        );
    }

    /**
     * Stop refresh timer for a specific connection
     */
    private stopRefreshTimer(connectionHash: string): void {
        const timerInfo = this._refreshTimers.get(connectionHash);
        if (timerInfo) {
            console.log(`[LocalCache] Stopping existing timer for connection ${connectionHash}`);
            clearInterval(timerInfo.timerId);

            // Disconnect the dedicated cache connection
            if (timerInfo.cacheOwnerUri) {
                console.log(
                    `[LocalCache] Disconnecting cache connection: ${timerInfo.cacheOwnerUri}`,
                );
                void this._connectionManager.disconnect(timerInfo.cacheOwnerUri);
            }

            this._refreshTimers.delete(connectionHash);
            this._client.logger.info(
                `[LocalCache] Stopped auto-refresh timer for connection ${connectionHash}`,
            );
        } else {
            console.log(`[LocalCache] No existing timer to stop for connection ${connectionHash}`);
        }
    }

    /**
     * Stop all refresh timers
     */
    private stopAllTimers(): void {
        for (const [connectionHash, timerInfo] of this._refreshTimers.entries()) {
            clearInterval(timerInfo.timerId);

            // Disconnect the dedicated cache connection
            if (timerInfo.cacheOwnerUri) {
                void this._connectionManager.disconnect(timerInfo.cacheOwnerUri);
            }

            this._client.logger.info(
                `[LocalCache] Stopped auto-refresh timer for connection ${connectionHash}`,
            );
        }
        this._refreshTimers.clear();
    }

    /**
     * Restart all active timers (called when configuration changes)
     */
    private restartAllTimers(): void {
        const activeTimers = Array.from(this._refreshTimers.values());
        this.stopAllTimers();

        if (this._isEnabled && this._autoRefreshEnabled) {
            for (const timerInfo of activeTimers) {
                // Get current ownerUri for the connection
                const ownerUri = this._connectionManager.getUriForConnection(timerInfo.credentials);
                if (ownerUri) {
                    this.startRefreshTimer(ownerUri, timerInfo.credentials);
                }
            }
        }
    }

    /**
     * Clean up timers for connections that are no longer active
     */
    private cleanupDisconnectedTimers(): void {
        for (const [connectionHash, timerInfo] of this._refreshTimers.entries()) {
            // Check if this connection is still active
            if (!this._connectionManager.isActiveConnection(timerInfo.credentials)) {
                this.stopRefreshTimer(connectionHash);
            }
        }
    }

    /**
     * Perform automatic cache refresh
     */
    private async performAutoRefresh(
        credentials: IConnectionInfo,
        connectionHash: string,
    ): Promise<void> {
        console.log(
            `[LocalCache] 🔄 performAutoRefresh called for ${credentials.server}/${credentials.database}`,
        );

        const timerInfo = this._refreshTimers.get(connectionHash);
        if (!timerInfo) {
            console.log(`[LocalCache] ❌ No timer info found for ${connectionHash}`);
            return;
        }

        // Skip if already refreshing
        if (timerInfo.isRefreshing) {
            console.log(`[LocalCache] ⏭️ Skipping - refresh already in progress`);
            this._client.logger.info(
                `[LocalCache] Skipping auto-refresh for ${credentials.server}/${credentials.database} - refresh already in progress`,
            );
            return;
        }

        // Use the dedicated cache connection URI
        const cacheOwnerUri = timerInfo.cacheOwnerUri;
        console.log(`[LocalCache] Using dedicated cache connection: ${cacheOwnerUri}`);

        // Check if the dedicated cache connection exists, if not create it
        console.log(`[LocalCache] Checking if cache connection exists...`);
        let isCacheConnected = this._connectionManager.isConnected(cacheOwnerUri);
        console.log(`[LocalCache] Cache connection exists: ${isCacheConnected}`);

        if (!isCacheConnected) {
            console.log(`[LocalCache] Creating new cache connection...`);
            this._client.logger.info(
                `[LocalCache] Creating dedicated cache connection for ${credentials.server}/${credentials.database}`,
            );

            try {
                // Create a new connection specifically for cache operations
                const connected = await this._connectionManager.connect(
                    cacheOwnerUri,
                    credentials,
                    false, // Don't show error dialogs
                );

                if (!connected) {
                    console.log(
                        `[LocalCache] ❌ STOPPING TIMER - failed to create cache connection`,
                    );
                    this._client.logger.error(
                        `[LocalCache] Failed to create cache connection for ${credentials.server}/${credentials.database}`,
                    );
                    this.stopRefreshTimer(connectionHash);
                    return;
                }

                console.log(`[LocalCache] ✅ Cache connection created successfully`);
                this._client.logger.info(
                    `[LocalCache] Cache connection created for ${credentials.server}/${credentials.database}`,
                );
            } catch (error) {
                console.error(`[LocalCache] ❌ Error creating cache connection:`, error);
                this._client.logger.error(`[LocalCache] Error creating cache connection: ${error}`);
                this.stopRefreshTimer(connectionHash);
                return;
            }
        }

        console.log(`[LocalCache] ✅ All validation checks passed!`);
        this._client.logger.info(
            `[LocalCache] Auto-refresh validation passed for ${credentials.server}/${credentials.database} (cacheOwnerUri: ${cacheOwnerUri})`,
        );

        try {
            timerInfo.isRefreshing = true;
            this._client.logger.info(
                `[LocalCache] Starting automatic cache refresh for ${credentials.server}/${credentials.database} (cacheOwnerUri: ${cacheOwnerUri})`,
            );

            sendActionEvent(TelemetryViews.LocalCache, TelemetryActions.UpdateCache, {
                automatic: "true",
            });

            await this.updateCache(cacheOwnerUri, credentials);

            this._client.logger.info(
                `[LocalCache] Automatic cache refresh completed for ${credentials.server}/${credentials.database}`,
            );
        } catch (error) {
            this._client.logger.error(
                `[LocalCache] Automatic cache refresh failed for ${credentials.server}/${credentials.database}: ${error}`,
            );
            sendErrorEvent(
                TelemetryViews.LocalCache,
                TelemetryActions.UpdateCache,
                error as Error,
                false,
                "automatic",
            );
        } finally {
            if (timerInfo) {
                timerInfo.isRefreshing = false;
            }
        }
    }

    /**
     * Generate a deterministic hash for a connection
     */
    private generateConnectionHash(credentials: IConnectionInfo): string {
        const hashInput = `${credentials.server}|${credentials.database}|${credentials.user || "integrated"}`;
        return crypto.createHash("sha256").update(hashInput).digest("hex").substring(0, 16);
    }

    /**
     * Get the cache directory for a specific connection
     */
    private getConnectionCacheDir(credentials: IConnectionInfo): vscode.Uri {
        const hash = this.generateConnectionHash(credentials);
        return vscode.Uri.joinPath(this._cacheBasePath, hash);
    }

    /**
     * Get the base path for all caches
     */
    public getCacheBasePath(): vscode.Uri {
        return this._cacheBasePath;
    }

    /**
     * Get the metadata file path for a connection
     */
    private getMetadataFilePath(cacheDir: vscode.Uri): vscode.Uri {
        return vscode.Uri.joinPath(cacheDir, "cache-metadata.json");
    }

    /**
     * Read cache metadata from disk
     */
    private async readMetadata(cacheDir: vscode.Uri): Promise<CacheMetadata | null> {
        try {
            const metadataPath = this.getMetadataFilePath(cacheDir);
            const data = await vscode.workspace.fs.readFile(metadataPath);
            return JSON.parse(new TextDecoder().decode(data));
        } catch {
            return null;
        }
    }

    /**
     * Write cache metadata to disk
     */
    private async writeMetadata(cacheDir: vscode.Uri, metadata: CacheMetadata): Promise<void> {
        const metadataPath = this.getMetadataFilePath(cacheDir);
        const data = new TextEncoder().encode(JSON.stringify(metadata, null, 2));
        await vscode.workspace.fs.writeFile(metadataPath, data);
    }

    /**
     * Query database for all objects and their modification dates
     * @param ownerUri Connection URI
     * @param existingMetadata Optional existing cache metadata for incremental updates
     */
    private async queryDatabaseObjects(
        ownerUri: string,
        existingMetadata?: CacheMetadata,
    ): Promise<DatabaseObject[]> {
        const query = `
            SELECT
                SCHEMA_NAME(schema_id) AS [schema],
                name,
                type_desc AS type,
                CONVERT(VARCHAR(30), modify_date, 127) AS modifyDate
            FROM sys.objects
            WHERE type IN (
                'U',  -- User table
                'V',  -- View
                'P',  -- Stored procedure
                'FN', -- Scalar function
                'IF', -- Inline table function
                'TF', -- Table function
                'TR'  -- Trigger
            )
            AND is_ms_shipped = 0
            ORDER BY SCHEMA_NAME(schema_id), name`;

        const result = await this._client.sendRequest(
            new RequestType<
                { ownerUri: string; queryString: string },
                SimpleExecuteResult,
                void,
                void
            >("query/simpleexecute"),
            {
                ownerUri: ownerUri,
                queryString: query,
            },
        );

        const objects: DatabaseObject[] = [];
        if (result && result.rows) {
            for (const row of result.rows) {
                const obj = {
                    schema: row[0]?.displayValue || "",
                    name: row[1]?.displayValue || "",
                    type: row[2]?.displayValue || "",
                    modifyDate: row[3]?.displayValue || "",
                };

                // If we have existing metadata, filter objects based on individual lastModified timestamps
                if (existingMetadata) {
                    const objectKey = `${obj.schema}.${obj.name}`;
                    const cachedObject = existingMetadata.objects[objectKey];

                    // Include if:
                    // 1. Object doesn't exist in cache (new object)
                    // 2. Object's modify_date is newer than cached lastModified
                    if (!cachedObject) {
                        this._client.logger.info(`New object detected: ${objectKey}`);
                        objects.push(obj);
                    } else {
                        // Convert both dates to Date objects for proper comparison
                        const dbModifyDate = new Date(obj.modifyDate);
                        const cachedModifyDate = new Date(cachedObject.lastModified);

                        if (dbModifyDate > cachedModifyDate) {
                            this._client.logger.info(
                                `Modified object detected: ${objectKey} (DB: ${obj.modifyDate}, Cache: ${cachedObject.lastModified})`,
                            );
                            objects.push(obj);
                        }
                    }
                } else {
                    // No metadata filter, include all objects
                    objects.push(obj);
                }
            }
        }

        return objects;
    }

    /**
     * Map SQL Server object type to folder name
     */
    private getObjectTypeFolder(type: string): string {
        const typeMap: Record<string, string> = {
            USER_TABLE: "tables",
            VIEW: "views",
            SQL_STORED_PROCEDURE: "stored-procedures",
            SQL_SCALAR_FUNCTION: "functions",
            SQL_INLINE_TABLE_VALUED_FUNCTION: "functions",
            SQL_TABLE_VALUED_FUNCTION: "functions",
            SQL_TRIGGER: "triggers",
        };
        return typeMap[type] || "other";
    }

    /**
     * Map SQL Server object type to scripting object type
     */
    private getScriptingObjectType(type: string): string {
        const typeMap: Record<string, string> = {
            USER_TABLE: "Table",
            VIEW: "View",
            SQL_STORED_PROCEDURE: "StoredProcedure",
            SQL_SCALAR_FUNCTION: "UserDefinedFunction",
            SQL_INLINE_TABLE_VALUED_FUNCTION: "UserDefinedFunction",
            SQL_TABLE_VALUED_FUNCTION: "UserDefinedFunction",
            SQL_TRIGGER: "Trigger",
        };
        return typeMap[type] || "Table";
    }

    /**
     * Script a single database object
     */
    private async scriptObject(ownerUri: string, obj: DatabaseObject): Promise<string | null> {
        try {
            const serverInfo = this._connectionManager.getServerInfo(
                this._connectionManager.getConnectionInfoFromUri(ownerUri),
            );

            const scriptingObject = {
                type: this.getScriptingObjectType(obj.type),
                schema: obj.schema,
                name: obj.name,
            };

            const scriptingParams = this._scriptingService.createScriptingParams(
                serverInfo,
                scriptingObject,
                ownerUri,
                ScriptOperation.Create,
            );

            const result = await this._scriptingService.script(scriptingParams);
            return result;
        } catch (error) {
            this._client.logger.error(
                `Failed to script object ${obj.schema}.${obj.name}: ${error}`,
            );
            return null;
        }
    }

    /**
     * Save a scripted object to disk
     */
    private async saveScriptedObject(
        cacheDir: vscode.Uri,
        obj: DatabaseObject,
        script: string,
    ): Promise<string> {
        const typeFolder = this.getObjectTypeFolder(obj.type);
        const folderPath = vscode.Uri.joinPath(cacheDir, typeFolder);

        // Ensure folder exists
        try {
            await vscode.workspace.fs.createDirectory(folderPath);
        } catch {
            // Folder might already exist
        }

        const fileName = `${obj.schema}.${obj.name}.sql`;
        const filePath = vscode.Uri.joinPath(folderPath, fileName);

        await vscode.workspace.fs.writeFile(filePath, new TextEncoder().encode(script));

        return `${typeFolder}/${fileName}`;
    }

    /**
     * Script multiple objects in batches
     * @param ownerUri Connection URI
     * @param objects Array of database objects to script
     * @param batchSize Number of objects to script concurrently (default: 10)
     * @param progress Optional progress reporter
     * @returns Map of object keys to their scripts (null if scripting failed)
     */
    private async scriptObjectsBatch(
        ownerUri: string,
        objects: DatabaseObject[],
        batchSize: number = 10,
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
    ): Promise<Map<string, string | null>> {
        const scripts = new Map<string, string | null>();
        const total = objects.length;
        let completed = 0;

        // Process objects in batches to avoid overwhelming the system
        for (let i = 0; i < objects.length; i += batchSize) {
            const batch = objects.slice(i, Math.min(i + batchSize, objects.length));

            // Script all objects in this batch concurrently
            const batchPromises = batch.map(async (obj) => {
                const objectKey = `${obj.schema}.${obj.name}`;
                try {
                    const script = await this.scriptObject(ownerUri, obj);
                    return { objectKey, script };
                } catch (error) {
                    this._client.logger.error(`Failed to script ${objectKey}: ${error}`);
                    return { objectKey, script: null };
                }
            });

            const batchResults = await Promise.all(batchPromises);

            // Store results
            for (const { objectKey, script } of batchResults) {
                scripts.set(objectKey, script);
                completed++;

                progress?.report({
                    message: `Scripting objects (${completed}/${total})...`,
                    increment: (1 / total) * 50, // Use 50% of progress for scripting
                });
            }
        }

        return scripts;
    }

    /**
     * Save multiple scripted objects to disk in batch
     * @param cacheDir Cache directory
     * @param objects Array of database objects
     * @param scripts Map of object keys to their scripts
     * @param progress Optional progress reporter
     * @returns Map of object keys to their file paths
     */
    private async saveScriptsBatch(
        cacheDir: vscode.Uri,
        objects: DatabaseObject[],
        scripts: Map<string, string | null>,
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
    ): Promise<Map<string, string>> {
        const filePaths = new Map<string, string>();
        const total = objects.length;
        let completed = 0;

        // Create all necessary directories first
        const typeFolders = new Set(objects.map((obj) => this.getObjectTypeFolder(obj.type)));
        for (const typeFolder of typeFolders) {
            const folderPath = vscode.Uri.joinPath(cacheDir, typeFolder);
            try {
                await vscode.workspace.fs.createDirectory(folderPath);
            } catch {
                // Folder might already exist
            }
        }

        // Save all files
        for (const obj of objects) {
            const objectKey = `${obj.schema}.${obj.name}`;
            const script = scripts.get(objectKey);

            if (script) {
                try {
                    const filePath = await this.saveScriptedObject(cacheDir, obj, script);
                    filePaths.set(objectKey, filePath);
                } catch (error) {
                    this._client.logger.error(`Failed to save ${objectKey}: ${error}`);
                }
            }

            completed++;
            progress?.report({
                message: `Saving files (${completed}/${total})...`,
                increment: (1 / total) * 50, // Use remaining 50% of progress for saving
            });
        }

        return filePaths;
    }

    /**
     * Perform initial cache population for a connection
     */
    public async populateCache(
        ownerUri: string,
        credentials: IConnectionInfo,
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
    ): Promise<void> {
        if (!this._isEnabled) {
            return;
        }

        try {
            sendActionEvent(TelemetryViews.LocalCache, TelemetryActions.PopulateCache);

            const cacheDir = this.getConnectionCacheDir(credentials);

            // Ensure cache directory exists
            await vscode.workspace.fs.createDirectory(cacheDir);

            // Query all database objects
            progress?.report({ message: "Querying database objects..." });
            const objects = await this.queryDatabaseObjects(ownerUri);

            if (objects.length === 0) {
                this._client.logger.info(
                    `No objects found to cache for ${credentials.server}/${credentials.database}`,
                );
                return;
            }

            this._client.logger.info(
                `Starting cache population for ${credentials.server}/${credentials.database}: ${objects.length} objects`,
            );

            // Phase 1: Script all objects in batches
            progress?.report({ message: "Scripting database objects..." });
            const scripts = await this.scriptObjectsBatch(ownerUri, objects, 10, progress);

            // Phase 2: Save all scripts to disk
            progress?.report({ message: "Saving scripts to disk..." });
            const filePaths = await this.saveScriptsBatch(cacheDir, objects, scripts, progress);

            // Build metadata
            const metadata: CacheMetadata = {
                lastCacheUpdate: new Date().toISOString(),
                connectionHash: this.generateConnectionHash(credentials),
                server: credentials.server,
                database: credentials.database,
                objects: {},
            };

            for (const obj of objects) {
                const objectKey = `${obj.schema}.${obj.name}`;
                const filePath = filePaths.get(objectKey);

                if (filePath) {
                    metadata.objects[objectKey] = {
                        type: obj.type,
                        lastModified: obj.modifyDate,
                        filePath: filePath,
                        schema: obj.schema,
                        name: obj.name,
                    };
                }
            }

            // Save metadata
            await this.writeMetadata(cacheDir, metadata);

            const successCount = filePaths.size;
            this._client.logger.info(
                `Cache populated for ${credentials.server}/${credentials.database}: ${successCount}/${objects.length} objects`,
            );
        } catch (error) {
            sendErrorEvent(
                TelemetryViews.LocalCache,
                TelemetryActions.PopulateCache,
                error as Error,
            );
            throw error;
        }
    }

    /**
     * Perform incremental cache update for a connection
     */
    public async updateCache(
        ownerUri: string,
        credentials: IConnectionInfo,
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
    ): Promise<void> {
        if (!this._isEnabled) {
            return;
        }

        try {
            sendActionEvent(TelemetryViews.LocalCache, TelemetryActions.UpdateCache);

            const cacheDir = this.getConnectionCacheDir(credentials);
            const existingMetadata = await this.readMetadata(cacheDir);

            if (!existingMetadata) {
                // No existing cache, perform full population
                return await this.populateCache(ownerUri, credentials, progress);
            }

            // Query modified/new objects (filtered by individual lastModified timestamps)
            progress?.report({ message: "Checking for modified objects..." });
            const objectsToUpdate = await this.queryDatabaseObjects(ownerUri, existingMetadata);

            // Query all current objects to detect deletions
            const allCurrentObjects = await this.queryDatabaseObjects(ownerUri);

            // Find objects that were deleted
            const objectsToDelete: string[] = [];
            const currentObjectKeys = new Set(
                allCurrentObjects.map((obj) => `${obj.schema}.${obj.name}`),
            );
            for (const objectKey of Object.keys(existingMetadata.objects)) {
                if (!currentObjectKeys.has(objectKey)) {
                    objectsToDelete.push(objectKey);
                }
            }

            if (objectsToUpdate.length === 0 && objectsToDelete.length === 0) {
                this._client.logger.info("Cache is up to date, no changes needed");
                return;
            }

            this._client.logger.info(
                `Updating cache: ${objectsToUpdate.length} to update, ${objectsToDelete.length} to delete`,
            );

            // Phase 1: Script all modified objects in batches
            if (objectsToUpdate.length > 0) {
                progress?.report({ message: "Scripting modified objects..." });
                const scripts = await this.scriptObjectsBatch(
                    ownerUri,
                    objectsToUpdate,
                    10,
                    progress,
                );

                // Phase 2: Save all scripts to disk
                progress?.report({ message: "Saving updated scripts..." });
                const filePaths = await this.saveScriptsBatch(
                    cacheDir,
                    objectsToUpdate,
                    scripts,
                    progress,
                );

                // Update metadata for modified objects
                for (const obj of objectsToUpdate) {
                    const objectKey = `${obj.schema}.${obj.name}`;
                    const filePath = filePaths.get(objectKey);

                    if (filePath) {
                        existingMetadata.objects[objectKey] = {
                            type: obj.type,
                            lastModified: obj.modifyDate,
                            filePath: filePath,
                            schema: obj.schema,
                            name: obj.name,
                        };
                    }
                }
            }

            // Phase 3: Delete removed objects
            if (objectsToDelete.length > 0) {
                progress?.report({ message: "Removing deleted objects..." });
                let deleteCompleted = 0;

                for (const objectKey of objectsToDelete) {
                    const cached = existingMetadata.objects[objectKey];
                    if (cached) {
                        try {
                            const filePath = vscode.Uri.joinPath(cacheDir, cached.filePath);
                            await vscode.workspace.fs.delete(filePath);
                        } catch {
                            // File might not exist
                        }
                        delete existingMetadata.objects[objectKey];
                    }

                    deleteCompleted++;
                    progress?.report({
                        message: `Removing deleted objects (${deleteCompleted}/${objectsToDelete.length})...`,
                        increment: (1 / objectsToDelete.length) * 20, // Use 20% for deletions
                    });
                }
            }

            // Update metadata
            existingMetadata.lastCacheUpdate = new Date().toISOString();
            await this.writeMetadata(cacheDir, existingMetadata);

            this._client.logger.info(
                `Cache updated for ${credentials.server}/${credentials.database}: ${objectsToUpdate.length} updated, ${objectsToDelete.length} deleted`,
            );

            // Fire event to notify that cache was updated
            if (objectsToUpdate.length > 0 || objectsToDelete.length > 0) {
                console.log(`[LocalCache] Firing cache updated event for ${credentials.database}`);
                this._onCacheUpdated.fire(credentials);
            }
        } catch (error) {
            sendErrorEvent(TelemetryViews.LocalCache, TelemetryActions.UpdateCache, error as Error);
            throw error;
        }
    }

    /**
     * Clear cache for a specific connection
     */
    public async clearCache(credentials: IConnectionInfo): Promise<void> {
        try {
            sendActionEvent(TelemetryViews.LocalCache, TelemetryActions.ClearCache);

            const cacheDir = this.getConnectionCacheDir(credentials);
            await vscode.workspace.fs.delete(cacheDir, { recursive: true });

            this._client.logger.info(
                `Cache cleared for ${credentials.server}/${credentials.database}`,
            );
        } catch (error) {
            sendErrorEvent(TelemetryViews.LocalCache, TelemetryActions.ClearCache, error as Error);
            throw error;
        }
    }

    /**
     * Clear all caches
     */
    public async clearAllCaches(): Promise<void> {
        try {
            sendActionEvent(TelemetryViews.LocalCache, TelemetryActions.ClearAllCaches);

            await vscode.workspace.fs.delete(this._cacheBasePath, { recursive: true });

            this._client.logger.info("All caches cleared");
        } catch (error) {
            sendErrorEvent(
                TelemetryViews.LocalCache,
                TelemetryActions.ClearAllCaches,
                error as Error,
            );
            throw error;
        }
    }

    /**
     * Get cache metadata for a connection
     */
    public async getCacheMetadata(credentials: IConnectionInfo): Promise<CacheMetadata | null> {
        const cacheDir = this.getConnectionCacheDir(credentials);
        return await this.readMetadata(cacheDir);
    }

    /**
     * Get cache status for a connection
     */
    public async getCacheStatus(credentials: IConnectionInfo): Promise<{
        exists: boolean;
        objectCount: number;
        lastUpdate?: string;
    }> {
        const cacheDir = this.getConnectionCacheDir(credentials);
        const metadata = await this.readMetadata(cacheDir);

        if (!metadata) {
            return { exists: false, objectCount: 0 };
        }

        return {
            exists: true,
            objectCount: Object.keys(metadata.objects).length,
            lastUpdate: metadata.lastCacheUpdate,
        };
    }

    /**
     * Check if a URI is valid for query execution (not an Object Explorer URI)
     */
    private isQueryableUri(ownerUri: string): boolean {
        // Object Explorer URIs follow the pattern: server_database_user_profileName
        // Query URIs are either file URIs, untitled documents, or vscode-mssql-adhoc://QueryN
        // We want to exclude Object Explorer URIs from automatic refresh

        // If it contains :// it's a proper URI scheme (file://, vscode-mssql-adhoc://, etc.)
        if (ownerUri.includes("://")) {
            return true;
        }

        // Check for untitled documents (untitled:Untitled-1)
        if (ownerUri.startsWith("untitled:")) {
            return true;
        }

        // If it doesn't contain :// and has underscores, it's likely an Object Explorer URI
        // Object Explorer URIs: "server_database_user_profile" or "server_database_profile"
        // We'll be conservative and only allow URIs with proper schemes
        return false;
    }

    /**
     * Handle successful connection event
     */
    public async onConnectionSuccess(
        ownerUri: string,
        credentials: IConnectionInfo,
    ): Promise<void> {
        console.log(
            `[LocalCache] onConnectionSuccess called - ownerUri: ${ownerUri}, server: ${credentials.server}, database: ${credentials.database}`,
        );
        console.log(`[LocalCache] _client exists: ${!!this._client}`);
        console.log(`[LocalCache] _client.logger exists: ${!!this._client?.logger}`);

        if (this._client?.logger) {
            this._client.logger.info(
                `[LocalCache] onConnectionSuccess called - ownerUri: ${ownerUri}, server: ${credentials.server}, database: ${credentials.database}`,
            );
        }

        if (!this._isEnabled) {
            console.log(`[LocalCache] Cache is disabled, skipping`);
            if (this._client?.logger) {
                this._client.logger.info(`[LocalCache] Cache is disabled, skipping`);
            }
            return;
        }

        // Only process connections with queryable URIs (not Object Explorer connections)
        if (!this.isQueryableUri(ownerUri)) {
            console.log(`[LocalCache] Skipping cache for Object Explorer connection: ${ownerUri}`);
            if (this._client?.logger) {
                this._client.logger.info(
                    `[LocalCache] Skipping cache for Object Explorer connection: ${ownerUri}`,
                );
            }
            return;
        }

        // Skip cache connections (they are internal connections used for cache refresh)
        if (ownerUri.startsWith("vscode-mssql-cache://")) {
            console.log(`[LocalCache] Skipping internal cache connection: ${ownerUri}`);
            if (this._client?.logger) {
                this._client.logger.info(
                    `[LocalCache] Skipping internal cache connection: ${ownerUri}`,
                );
            }
            return;
        }

        console.log(
            `[LocalCache] Processing connection for ${credentials.server}/${credentials.database}`,
        );
        if (this._client?.logger) {
            this._client.logger.info(
                `[LocalCache] Processing connection for ${credentials.server}/${credentials.database}`,
            );
        }

        // Create a dedicated cache URI for this connection
        const connectionHash = this.generateConnectionHash(credentials);
        const cacheOwnerUri = `vscode-mssql-cache://${connectionHash}`;
        console.log(`[LocalCache] Using dedicated cache URI: ${cacheOwnerUri}`);

        // Ensure the cache connection exists
        if (!this._connectionManager.isConnected(cacheOwnerUri)) {
            console.log(`[LocalCache] Creating cache connection...`);
            try {
                const connected = await this._connectionManager.connect(
                    cacheOwnerUri,
                    credentials,
                    false, // Don't show error dialogs
                );

                if (!connected) {
                    console.error(`[LocalCache] Failed to create cache connection`);
                    this._client.logger.error(
                        `[LocalCache] Failed to create cache connection for ${credentials.server}/${credentials.database}`,
                    );
                    return;
                }
                console.log(`[LocalCache] Cache connection created successfully`);
            } catch (error) {
                console.error(`[LocalCache] Error creating cache connection:`, error);
                this._client.logger.error(`[LocalCache] Error creating cache connection: ${error}`);
                return;
            }
        }

        try {
            console.log(`[LocalCache] Getting cache status...`);
            const status = await this.getCacheStatus(credentials);
            console.log(`[LocalCache] Cache exists: ${status.exists}`);

            if (!status.exists) {
                console.log(`[LocalCache] Starting initial cache population...`);
                // First connection - populate cache in background
                void vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Caching database objects for ${credentials.database}`,
                        cancellable: false,
                    },
                    async (progress) => {
                        try {
                            await this.populateCache(cacheOwnerUri, credentials, progress);
                            void vscode.window.showInformationMessage(
                                `Database cache created for ${credentials.database}`,
                            );
                        } catch (error) {
                            console.error(`[LocalCache] Failed to populate cache:`, error);
                            this._client.logger.error(`Failed to populate cache: ${error}`);
                        }
                    },
                );
            } else {
                console.log(`[LocalCache] Starting cache update...`);
                // Existing cache - update in background
                void vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Window,
                        title: `Updating cache for ${credentials.database}`,
                        cancellable: false,
                    },
                    async (progress) => {
                        try {
                            await this.updateCache(cacheOwnerUri, credentials, progress);
                        } catch (error) {
                            console.error(`[LocalCache] Failed to update cache:`, error);
                            this._client.logger.error(`Failed to update cache: ${error}`);
                        }
                    },
                );
            }

            // Start automatic refresh timer
            console.log(`[LocalCache] About to start refresh timer...`);
            this.startRefreshTimer(ownerUri, credentials);
            console.log(`[LocalCache] Refresh timer started (or skipped if disabled)`);
        } catch (error) {
            console.error(`[LocalCache] Error in cache service:`, error);
            this._client.logger.error(`Error in cache service: ${error}`);
        }
    }

    /**
     * Manually refresh cache for a connection (called from command)
     */
    public async manualRefresh(ownerUri: string, credentials: IConnectionInfo): Promise<void> {
        if (!this._isEnabled) {
            void vscode.window.showWarningMessage("Local cache is disabled");
            return;
        }

        const connectionHash = this.generateConnectionHash(credentials);
        const timerInfo = this._refreshTimers.get(connectionHash);

        // Check if automatic refresh is already running
        if (timerInfo?.isRefreshing) {
            void vscode.window.showInformationMessage(
                "Cache refresh is already in progress. Please wait...",
            );
            return;
        }

        // Use dedicated cache URI if available, otherwise use the provided ownerUri
        let cacheOwnerUri = ownerUri;
        if (timerInfo?.cacheOwnerUri) {
            // Use the existing dedicated cache connection URI
            cacheOwnerUri = timerInfo.cacheOwnerUri;
            console.log(`[LocalCache] Using existing dedicated cache URI: ${cacheOwnerUri}`);
        } else {
            // Create a dedicated cache URI for this manual refresh
            cacheOwnerUri = `vscode-mssql-cache://${connectionHash}`;
            console.log(`[LocalCache] Created new dedicated cache URI: ${cacheOwnerUri}`);
        }

        // Ensure the cache connection exists
        if (!this._connectionManager.isConnected(cacheOwnerUri)) {
            console.log(`[LocalCache] Cache connection doesn't exist, creating it...`);
            try {
                const connected = await this._connectionManager.connect(
                    cacheOwnerUri,
                    credentials,
                    false, // Don't show error dialogs
                );

                if (!connected) {
                    void vscode.window.showErrorMessage(
                        `Failed to create cache connection for ${credentials.database}`,
                    );
                    return;
                }
                console.log(`[LocalCache] Cache connection created successfully`);
            } catch (error) {
                console.error(`[LocalCache] Error creating cache connection:`, error);
                void vscode.window.showErrorMessage(
                    `Failed to create cache connection: ${error instanceof Error ? error.message : String(error)}`,
                );
                return;
            }
        }

        // Perform manual refresh with progress notification
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Refreshing cache for ${credentials.database}`,
                cancellable: false,
            },
            async (progress) => {
                try {
                    sendActionEvent(TelemetryViews.LocalCache, TelemetryActions.UpdateCache, {
                        manual: "true",
                    });

                    await this.updateCache(cacheOwnerUri, credentials, progress);

                    void vscode.window.showInformationMessage(
                        `Cache refreshed for ${credentials.database}`,
                    );
                } catch (error) {
                    this._client.logger.error(`Failed to refresh cache: ${error}`);
                    void vscode.window.showErrorMessage(
                        `Failed to refresh cache: ${error instanceof Error ? error.message : String(error)}`,
                    );

                    sendErrorEvent(
                        TelemetryViews.LocalCache,
                        TelemetryActions.UpdateCache,
                        error as Error,
                        false,
                        "manual",
                    );
                }
            },
        );
    }
}
