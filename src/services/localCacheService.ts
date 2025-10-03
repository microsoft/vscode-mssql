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
export class LocalCacheService {
    private _client: SqlToolsServiceClient;
    private _scriptingService: ScriptingService;
    private _globalStorageUri: vscode.Uri;
    private _cacheBasePath: vscode.Uri;
    private _isEnabled: boolean = true;

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
            }
        });
    }

    private updateConfiguration(): void {
        const config = vscode.workspace.getConfiguration("mssql.localCache");
        this._isEnabled = config.get<boolean>("enabled", true);
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
     */
    private async queryDatabaseObjects(ownerUri: string): Promise<DatabaseObject[]> {
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
            ORDER BY SCHEMA_NAME(schema_id), name
        `;

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
                objects.push({
                    schema: row[0]?.displayValue || "",
                    name: row[1]?.displayValue || "",
                    type: row[2]?.displayValue || "",
                    modifyDate: row[3]?.displayValue || "",
                });
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

            const metadata: CacheMetadata = {
                lastCacheUpdate: new Date().toISOString(),
                connectionHash: this.generateConnectionHash(credentials),
                server: credentials.server,
                database: credentials.database,
                objects: {},
            };

            const total = objects.length;
            let completed = 0;

            // Script and save each object
            for (const obj of objects) {
                const objectKey = `${obj.schema}.${obj.name}`;
                progress?.report({
                    message: `Caching ${objectKey} (${completed + 1}/${total})...`,
                    increment: (1 / total) * 100,
                });

                const script = await this.scriptObject(ownerUri, obj);
                if (script) {
                    const filePath = await this.saveScriptedObject(cacheDir, obj, script);

                    metadata.objects[objectKey] = {
                        type: obj.type,
                        lastModified: obj.modifyDate,
                        filePath: filePath,
                        schema: obj.schema,
                        name: obj.name,
                    };
                }

                completed++;
            }

            // Save metadata
            await this.writeMetadata(cacheDir, metadata);

            this._client.logger.info(
                `Cache populated for ${credentials.server}/${credentials.database}: ${completed} objects`,
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

            // Query current database objects
            progress?.report({ message: "Checking for modified objects..." });
            const currentObjects = await this.queryDatabaseObjects(ownerUri);

            const objectsToUpdate: DatabaseObject[] = [];
            const objectsToDelete: string[] = [];

            // Find objects that need updating
            for (const obj of currentObjects) {
                const objectKey = `${obj.schema}.${obj.name}`;
                const cached = existingMetadata.objects[objectKey];

                if (!cached || cached.lastModified !== obj.modifyDate) {
                    objectsToUpdate.push(obj);
                }
            }

            // Find objects that were deleted
            const currentObjectKeys = new Set(
                currentObjects.map((obj) => `${obj.schema}.${obj.name}`),
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

            const total = objectsToUpdate.length + objectsToDelete.length;
            let completed = 0;

            // Update modified objects
            for (const obj of objectsToUpdate) {
                const objectKey = `${obj.schema}.${obj.name}`;
                progress?.report({
                    message: `Updating ${objectKey} (${completed + 1}/${total})...`,
                    increment: (1 / total) * 100,
                });

                const script = await this.scriptObject(ownerUri, obj);
                if (script) {
                    const filePath = await this.saveScriptedObject(cacheDir, obj, script);

                    existingMetadata.objects[objectKey] = {
                        type: obj.type,
                        lastModified: obj.modifyDate,
                        filePath: filePath,
                        schema: obj.schema,
                        name: obj.name,
                    };
                }

                completed++;
            }

            // Delete removed objects
            for (const objectKey of objectsToDelete) {
                progress?.report({
                    message: `Removing ${objectKey} (${completed + 1}/${total})...`,
                    increment: (1 / total) * 100,
                });

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

                completed++;
            }

            // Update metadata
            existingMetadata.lastCacheUpdate = new Date().toISOString();
            await this.writeMetadata(cacheDir, existingMetadata);

            this._client.logger.info(
                `Cache updated for ${credentials.server}/${credentials.database}: ${objectsToUpdate.length} updated, ${objectsToDelete.length} deleted`,
            );
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
     * Handle successful connection event
     */
    public async onConnectionSuccess(
        ownerUri: string,
        credentials: IConnectionInfo,
    ): Promise<void> {
        if (!this._isEnabled) {
            return;
        }

        try {
            const status = await this.getCacheStatus(credentials);

            if (!status.exists) {
                // First connection - populate cache in background
                void vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Caching database objects for ${credentials.database}`,
                        cancellable: false,
                    },
                    async (progress) => {
                        try {
                            await this.populateCache(ownerUri, credentials, progress);
                            void vscode.window.showInformationMessage(
                                `Database cache created for ${credentials.database}`,
                            );
                        } catch (error) {
                            this._client.logger.error(`Failed to populate cache: ${error}`);
                        }
                    },
                );
            } else {
                // Existing cache - update in background
                void vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Window,
                        title: `Updating cache for ${credentials.database}`,
                        cancellable: false,
                    },
                    async (progress) => {
                        try {
                            await this.updateCache(ownerUri, credentials, progress);
                        } catch (error) {
                            this._client.logger.error(`Failed to update cache: ${error}`);
                        }
                    },
                );
            }
        } catch (error) {
            this._client.logger.error(`Error in cache service: ${error}`);
        }
    }
}
