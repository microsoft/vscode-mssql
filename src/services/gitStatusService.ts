/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { IConnectionInfo, ObjectMetadata } from "vscode-mssql";
import { GitIntegrationService } from "./gitIntegrationService";
import { LocalCacheService } from "./localCacheService";
import { GitObjectStatus, GitObjectStatusInfo, DatabaseGitInfo } from "../models/gitStatus";

/**
 * Service for managing Git status decorations in Object Explorer
 */
export class GitStatusService {
    private _gitIntegrationService: GitIntegrationService;
    private _localCacheService: LocalCacheService;

    // Cache of Git status for database objects
    // Key: connectionHash|objectType|schema|name
    private _statusCache: Map<string, GitObjectStatusInfo> = new Map();

    // Cache of database Git link information
    // Key: connectionHash
    private _databaseGitInfoCache: Map<string, DatabaseGitInfo> = new Map();

    constructor(
        gitIntegrationService: GitIntegrationService,
        localCacheService: LocalCacheService,
    ) {
        this._gitIntegrationService = gitIntegrationService;
        this._localCacheService = localCacheService;
    }

    /**
     * Get Git link information for a database
     */
    public async getDatabaseGitInfo(credentials: IConnectionInfo): Promise<DatabaseGitInfo> {
        const connectionHash = this._gitIntegrationService.generateConnectionHash(credentials);

        // Check cache first
        if (this._databaseGitInfoCache.has(connectionHash)) {
            return this._databaseGitInfoCache.get(connectionHash)!;
        }

        // Get link status from GitIntegrationService
        const linkStatus = await this._gitIntegrationService.getLinkStatus(credentials);

        const gitInfo: DatabaseGitInfo = {
            isLinked: linkStatus.isLinked,
            repositoryUrl: linkStatus.metadata?.repositoryUrl,
            branch: linkStatus.metadata?.branch,
            lastSyncAt: linkStatus.metadata?.lastSyncAt,
            localPath: linkStatus.localPath,
        };

        // Cache the result
        this._databaseGitInfoCache.set(connectionHash, gitInfo);

        return gitInfo;
    }

    /**
     * Get Git status for a database object
     */
    public async getObjectStatus(
        credentials: IConnectionInfo,
        metadata: ObjectMetadata,
    ): Promise<GitObjectStatusInfo> {
        const connectionHash = this._gitIntegrationService.generateConnectionHash(credentials);
        const cacheKey = this._getObjectCacheKey(connectionHash, metadata);

        // Check cache first
        if (this._statusCache.has(cacheKey)) {
            return this._statusCache.get(cacheKey)!;
        }

        // Get database Git info
        const gitInfo = await this.getDatabaseGitInfo(credentials);

        // If database is not linked to Git, return Untracked status
        if (!gitInfo.isLinked) {
            const statusInfo: GitObjectStatusInfo = {
                status: GitObjectStatus.Untracked,
            };
            this._statusCache.set(cacheKey, statusInfo);
            return statusInfo;
        }

        // Compare local cache with Git repository
        const statusInfo = await this._compareWithGit(connectionHash, metadata, gitInfo.localPath!);

        // Cache the result
        this._statusCache.set(cacheKey, statusInfo);

        return statusInfo;
    }

    /**
     * Clear the status cache for a specific database or all databases
     */
    public clearCache(credentials?: IConnectionInfo): void {
        if (credentials) {
            const connectionHash = this._gitIntegrationService.generateConnectionHash(credentials);

            // Clear database Git info cache
            this._databaseGitInfoCache.delete(connectionHash);

            // Clear object status cache for this database
            const keysToDelete: string[] = [];
            for (const key of this._statusCache.keys()) {
                if (key.startsWith(connectionHash + "|")) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach((key) => this._statusCache.delete(key));
        } else {
            // Clear all caches
            this._statusCache.clear();
            this._databaseGitInfoCache.clear();
        }
    }

    /**
     * Compare local cached object with Git repository
     */
    private async _compareWithGit(
        connectionHash: string,
        metadata: ObjectMetadata,
        gitRepoPath: string,
    ): Promise<GitObjectStatusInfo> {
        try {
            // Get local cached content
            const localContent = await this._getLocalCachedContent(connectionHash, metadata);

            // Get Git repository content
            const gitPath = this._getGitFilePath(metadata);
            const gitFilePath = path.join(gitRepoPath, gitPath);
            const gitContent = await this._getGitFileContent(gitFilePath);

            // Determine status based on existence and content
            if (!localContent && !gitContent) {
                return { status: GitObjectStatus.Unknown };
            } else if (!localContent && gitContent) {
                return {
                    status: GitObjectStatus.Deleted,
                    gitPath,
                    gitContent,
                };
            } else if (localContent && !gitContent) {
                return {
                    status: GitObjectStatus.Added,
                    gitPath,
                    localContent,
                };
            } else {
                // Both exist - compare content
                const isInSync = this._compareContent(localContent!, gitContent!);
                return {
                    status: isInSync ? GitObjectStatus.InSync : GitObjectStatus.Modified,
                    gitPath,
                    localContent,
                    gitContent,
                };
            }
        } catch (error) {
            console.error(`[GitStatusService] Error comparing object with Git:`, error);
            return { status: GitObjectStatus.Unknown };
        }
    }

    /**
     * Get local cached content for an object
     */
    private async _getLocalCachedContent(
        connectionHash: string,
        metadata: ObjectMetadata,
    ): Promise<string | undefined> {
        try {
            const cacheBasePath = this._localCacheService.getCacheBasePath();
            const cachePath = vscode.Uri.joinPath(cacheBasePath, connectionHash);
            const filePath = this._getLocalCacheFilePath(metadata);
            const fullPath = path.join(cachePath.fsPath, filePath);

            const content = await fs.readFile(fullPath, "utf-8");
            return content;
        } catch (error) {
            // File doesn't exist or can't be read
            return undefined;
        }
    }

    /**
     * Get Git repository file content
     */
    private async _getGitFileContent(filePath: string): Promise<string | undefined> {
        try {
            const content = await fs.readFile(filePath, "utf-8");
            return content;
        } catch (error) {
            // File doesn't exist or can't be read
            return undefined;
        }
    }

    /**
     * Compare two content strings (normalize whitespace and line endings)
     */
    private _compareContent(content1: string, content2: string): boolean {
        const normalize = (str: string) => {
            return str
                .replace(/\r\n/g, "\n") // Normalize line endings
                .replace(/\s+$/gm, "") // Remove trailing whitespace
                .trim();
        };

        return normalize(content1) === normalize(content2);
    }

    /**
     * Get the file path for an object in the local cache
     * Note: LocalCacheService uses lowercase folder names with hyphens
     */
    private _getLocalCacheFilePath(metadata: ObjectMetadata): string {
        const objectType = metadata.metadataTypeName;
        const schema = metadata.schema || "dbo";
        const name = metadata.name;

        switch (objectType) {
            case "Table":
                return `tables/${schema}.${name}.sql`;
            case "View":
                return `views/${schema}.${name}.sql`;
            case "StoredProcedure":
                return `stored-procedures/${schema}.${name}.sql`;
            case "UserDefinedFunction":
                return `functions/${schema}.${name}.sql`;
            case "Trigger":
                return `triggers/${schema}.${name}.sql`;
            default:
                return `other/${schema}.${name}.sql`;
        }
    }

    /**
     * Get the file path for an object in the Git repository
     */
    private _getGitFilePath(metadata: ObjectMetadata): string {
        // Use the same path structure as local cache
        return this._getLocalCacheFilePath(metadata);
    }

    /**
     * Generate cache key for an object
     */
    private _getObjectCacheKey(connectionHash: string, metadata: ObjectMetadata): string {
        const objectType = metadata.metadataTypeName;
        const schema = metadata.schema || "dbo";
        const name = metadata.name;
        return `${connectionHash}|${objectType}|${schema}|${name}`;
    }
}
