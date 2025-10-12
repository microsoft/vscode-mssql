/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { IConnectionInfo, ObjectMetadata, SimpleExecuteResult } from "vscode-mssql";
import { GitIntegrationService } from "../services/gitIntegrationService";
import { LocalCacheService } from "../services/localCacheService";
import { GitStatusService } from "../services/gitStatusService";
import { GitObjectStatus } from "../models/gitStatus";
import ConnectionManager from "../controllers/connectionManager";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import { getErrorMessage } from "../utils/utils";
import { TableMigrationService } from "./tableMigrationService";

/**
 * Represents a database object change in the source control view
 */
export class DatabaseResourceState implements vscode.SourceControlResourceState {
    public readonly resourceUri: vscode.Uri;
    public readonly decorations?: vscode.SourceControlResourceDecorations;
    public readonly command?: vscode.Command;

    constructor(
        public readonly metadata: ObjectMetadata,
        public readonly status: GitObjectStatus,
        public readonly connectionHash: string,
        public readonly credentials: IConnectionInfo,
        public readonly localCachePath: string,
        public readonly gitRepoPath: string,
    ) {
        // Create a unique URI for this resource
        this.resourceUri = vscode.Uri.parse(
            `mssql-scm://${credentials.server}/${credentials.database}/${metadata.metadataTypeName}/${metadata.schema || "dbo"}/${metadata.name}`,
        );

        // Set decorations based on status
        this.decorations = this._getDecorations();

        // Set command to open diff view when clicked
        this.command = {
            command: "mssql.sourceControl.openDiff",
            title: "Open Diff",
            arguments: [this],
        };
    }

    private _getDecorations(): vscode.SourceControlResourceDecorations {
        switch (this.status) {
            case GitObjectStatus.Modified:
                return {
                    strikeThrough: false,
                    faded: false,
                    tooltip: "Modified",
                    iconPath: new vscode.ThemeIcon(
                        "diff-modified",
                        new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
                    ),
                };
            case GitObjectStatus.Added:
                return {
                    strikeThrough: false,
                    faded: false,
                    tooltip: "Added (new object)",
                    iconPath: new vscode.ThemeIcon(
                        "diff-added",
                        new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
                    ),
                };
            case GitObjectStatus.Deleted:
                return {
                    strikeThrough: true,
                    faded: true,
                    tooltip: "Deleted (exists in Git but not in database)",
                    iconPath: new vscode.ThemeIcon(
                        "diff-removed",
                        new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
                    ),
                };
            default:
                return {
                    strikeThrough: false,
                    faded: false,
                    tooltip: "Unknown status",
                };
        }
    }

    /**
     * Get the label to display in the source control view
     */
    public get label(): string {
        return `${this.metadata.schema || "dbo"}.${this.metadata.name}`;
    }

    /**
     * Get the description to display in the source control view
     */
    public get description(): string {
        return this.metadata.metadataTypeName;
    }
}

/**
 * Source Control Provider for database objects
 */
export class DatabaseSourceControlProvider implements vscode.Disposable {
    private _sourceControl: vscode.SourceControl;
    private _changesGroup: vscode.SourceControlResourceGroup;
    private _stagedGroup: vscode.SourceControlResourceGroup;
    private _disposables: vscode.Disposable[] = [];
    private _currentDatabase?: { credentials: IConnectionInfo; connectionHash: string };
    private _tableMigrationService: TableMigrationService;
    private _lastRefreshTime?: number;

    constructor(
        private _gitIntegrationService: GitIntegrationService,
        private _localCacheService: LocalCacheService,
        private _gitStatusService: GitStatusService,
        private _connectionManager: ConnectionManager,
        private _sqlToolsClient: SqlToolsServiceClient,
    ) {
        // Initialize table migration service
        this._tableMigrationService = new TableMigrationService({
            includeDrop: true,
            includeComments: true,
        });
        // Create source control instance
        this._sourceControl = vscode.scm.createSourceControl(
            "mssql-database",
            "MSSQL Database",
            vscode.Uri.parse("mssql-scm://"),
        );
        this._sourceControl.quickDiffProvider = this;
        this._disposables.push(this._sourceControl);

        // Create resource groups
        this._changesGroup = this._sourceControl.createResourceGroup("changes", "Changes");
        this._stagedGroup = this._sourceControl.createResourceGroup("staged", "Staged Changes");

        // Set input box placeholder
        this._sourceControl.inputBox.placeholder =
            "Description (press Ctrl+Enter to apply to local Git repo)";

        // Set accept input command (for applying changes to Git repo)
        this._sourceControl.acceptInputCommand = {
            command: "mssql.sourceControl.commit",
            title: "Apply to Git Repo",
            tooltip: "Copy staged changes to local Git repository (does not commit or push)",
        };

        // Register commands
        this._registerCommands();
    }

    /**
     * Register source control commands
     */
    private _registerCommands(): void {
        // Stage a change
        this._disposables.push(
            vscode.commands.registerCommand(
                "mssql.sourceControl.stage",
                async (resourceState: DatabaseResourceState) => {
                    await this._stageChange(resourceState);
                },
            ),
        );

        // Unstage a change
        this._disposables.push(
            vscode.commands.registerCommand(
                "mssql.sourceControl.unstage",
                async (resourceState: DatabaseResourceState) => {
                    await this._unstageChange(resourceState);
                },
            ),
        );

        // Stage all changes
        this._disposables.push(
            vscode.commands.registerCommand("mssql.sourceControl.stageAll", async () => {
                await this._stageAllChanges();
            }),
        );

        // Unstage all changes
        this._disposables.push(
            vscode.commands.registerCommand("mssql.sourceControl.unstageAll", async () => {
                await this._unstageAllChanges();
            }),
        );

        // Apply changes to Git repo (local only, no commit/push)
        this._disposables.push(
            vscode.commands.registerCommand("mssql.sourceControl.commit", async () => {
                await this._applyToGitRepo();
            }),
        );

        // Open diff view
        this._disposables.push(
            vscode.commands.registerCommand(
                "mssql.sourceControl.openDiff",
                async (resourceState: DatabaseResourceState) => {
                    await this._openDiff(resourceState);
                },
            ),
        );

        // Discard changes
        this._disposables.push(
            vscode.commands.registerCommand(
                "mssql.sourceControl.discard",
                async (resourceState: DatabaseResourceState) => {
                    await this._discardChanges(resourceState);
                },
            ),
        );
    }

    /**
     * Show changes for a specific database
     */
    public async showChanges(credentials: IConnectionInfo): Promise<void> {
        const connectionHash = this._gitIntegrationService.generateConnectionHash(credentials);

        // Check if database is linked to Git
        const gitInfo = await this._gitStatusService.getDatabaseGitInfo(credentials);
        if (!gitInfo.isLinked) {
            vscode.window.showWarningMessage(
                `Database ${credentials.database} is not linked to a Git repository. Use "Link to Git Branch..." first.`,
            );
            return;
        }

        // Clear the Git status cache to get fresh comparison results
        console.log("[SourceControl] Clearing Git status cache for fresh comparison");
        this._gitStatusService.clearCache(credentials);

        // Store current database
        this._currentDatabase = { credentials, connectionHash };

        // Note: label is read-only, set in constructor

        // Load changes with progress notification
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Loading changes for ${credentials.database}`,
                cancellable: false,
            },
            async (progress) => {
                await this._refreshChanges(progress);
            },
        );
    }

    /**
     * Refresh the Source Control view if it's currently showing changes for the specified database
     */
    public async refreshIfActive(credentials: IConnectionInfo): Promise<void> {
        if (!this._currentDatabase) {
            return;
        }

        // Check if the Source Control view is currently showing this database
        const connectionHash = this._gitIntegrationService.generateConnectionHash(credentials);
        if (this._currentDatabase.connectionHash === connectionHash) {
            console.log(
                `[SourceControl] Cache updated for active database ${credentials.database}, refreshing view`,
            );

            // Debounce: Don't refresh if we just refreshed recently (within 2 seconds)
            const now = Date.now();
            if (this._lastRefreshTime && now - this._lastRefreshTime < 2000) {
                console.log(
                    `[SourceControl] Skipping refresh - last refresh was ${now - this._lastRefreshTime}ms ago`,
                );
                return;
            }

            this._lastRefreshTime = now;

            // Refresh without progress notification (background refresh)
            await this._refreshChanges(undefined);
        }
    }

    /**
     * Refresh the list of changes
     */
    private async _refreshChanges(
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
    ): Promise<void> {
        const startTime = Date.now();

        if (!this._currentDatabase) {
            console.log("[SourceControl] No current database");
            return;
        }

        const { credentials, connectionHash } = this._currentDatabase;

        // Get all cached objects
        progress?.report({ message: "Loading cache metadata...", increment: 0 });
        const metadataStartTime = Date.now();
        const cacheMetadata = await this._localCacheService.getCacheMetadata(credentials);
        const metadataTime = Date.now() - metadataStartTime;
        console.log(
            `[SourceControl] Cache metadata loaded in ${metadataTime}ms:`,
            cacheMetadata ? `${Object.keys(cacheMetadata.objects).length} objects` : "null",
        );
        if (!cacheMetadata) {
            this._changesGroup.resourceStates = [];
            return;
        }

        // Get Git repository path
        progress?.report({ message: "Checking Git link status...", increment: 5 });
        const gitInfo = await this._gitStatusService.getDatabaseGitInfo(credentials);
        console.log(
            `[SourceControl] Git info: isLinked=${gitInfo.isLinked}, localPath=${gitInfo.localPath}`,
        );
        if (!gitInfo.isLinked || !gitInfo.localPath) {
            this._changesGroup.resourceStates = [];
            return;
        }

        // Check status of each object in batches for better performance
        const comparisonStartTime = Date.now();
        const changes: DatabaseResourceState[] = [];
        const objectKeys = Object.keys(cacheMetadata.objects);
        const totalObjects = objectKeys.length;
        let checkedCount = 0;

        // Process in batches of 100 objects for progress reporting
        const batchSize = 100;
        const batches = [];
        for (let i = 0; i < objectKeys.length; i += batchSize) {
            batches.push(objectKeys.slice(i, i + batchSize));
        }

        console.log(
            `[SourceControl] Comparing ${totalObjects} database objects in ${batches.length} batches of ${batchSize}`,
        );

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            const batchStartTime = Date.now();

            // Process batch in parallel (up to 50 concurrent operations)
            const batchPromises = batch.map(async (objKey) => {
                const obj = cacheMetadata.objects[objKey];
                const metadata: ObjectMetadata = {
                    metadataTypeName: obj.type,
                    schema: obj.schema,
                    name: obj.name,
                    metadataType: 0, // Not used for comparison
                    urn: `${obj.schema}.${obj.name}`, // URN for the object
                };

                const statusInfo = await this._gitStatusService.getObjectStatus(
                    credentials,
                    metadata,
                );

                // Only include objects with changes
                if (
                    statusInfo.status !== GitObjectStatus.InSync &&
                    statusInfo.status !== GitObjectStatus.Unknown
                ) {
                    const localCachePath = this._getLocalCachePath(connectionHash, metadata);
                    const gitRepoPath = this._getGitRepoPath(gitInfo.localPath, metadata);

                    return new DatabaseResourceState(
                        metadata,
                        statusInfo.status,
                        connectionHash,
                        credentials,
                        localCachePath,
                        gitRepoPath,
                    );
                }
                return null;
            });

            // Wait for batch to complete
            const batchResults = await Promise.all(batchPromises);
            const batchChanges = batchResults.filter((r) => r !== null) as DatabaseResourceState[];
            changes.push(...batchChanges);

            checkedCount += batch.length;
            const batchTime = Date.now() - batchStartTime;
            const avgTimePerObject = batchTime / batch.length;

            // Update progress
            const percentComplete = Math.floor((checkedCount / totalObjects) * 45) + 10; // 10-55%
            progress?.report({
                message: `Checking database objects: ${checkedCount}/${totalObjects} (${batchChanges.length} changes found)`,
                increment: percentComplete,
            });

            // Log batch performance
            if (batchIndex === 0 || batchIndex === batches.length - 1 || batchIndex % 10 === 0) {
                console.log(
                    `[SourceControl] DB Batch ${batchIndex + 1}/${batches.length}: ${batch.length} objects in ${batchTime}ms (${avgTimePerObject.toFixed(1)}ms/object), ${batchChanges.length} changes`,
                );
            }
        }

        const comparisonTime = Date.now() - comparisonStartTime;
        const avgTimePerObject = totalObjects > 0 ? comparisonTime / totalObjects : 0;
        console.log(
            `[SourceControl] Database comparison complete: ${checkedCount} objects in ${comparisonTime}ms (${avgTimePerObject.toFixed(1)}ms/object), found ${changes.length} changes`,
        );

        // Check for deleted objects (exist in Git but not in database)
        progress?.report({ message: "Checking for deleted objects...", increment: 60 });
        const deletedObjectsStartTime = Date.now();
        const deletedObjects = await this._findDeletedObjects(
            gitInfo.localPath,
            cacheMetadata,
            connectionHash,
            credentials,
        );
        const deletedObjectsTime = Date.now() - deletedObjectsStartTime;
        console.log(
            `[SourceControl] Deleted objects check complete: found ${deletedObjects.length} deleted objects in ${deletedObjectsTime}ms`,
        );
        changes.push(...deletedObjects);

        // Update changes group (exclude staged items)
        progress?.report({ message: "Updating view...", increment: 95 });
        const stagedUris = new Set(
            this._stagedGroup.resourceStates.map((r) => r.resourceUri.toString()),
        );
        this._changesGroup.resourceStates = changes.filter(
            (c) => !stagedUris.has(c.resourceUri.toString()),
        );

        // Update count badge
        this._sourceControl.count = changes.length;

        const totalTime = Date.now() - startTime;
        console.log(
            `[SourceControl] ✅ Complete in ${totalTime}ms: Displaying ${this._changesGroup.resourceStates.length} changes (${this._stagedGroup.resourceStates.length} staged)`,
        );
        console.log(
            `[SourceControl] Performance breakdown: metadata=${metadataTime}ms, dbComparison=${comparisonTime}ms (${avgTimePerObject.toFixed(1)}ms/object), deletedCheck=${deletedObjectsTime}ms`,
        );

        progress?.report({ message: "Done!", increment: 100 });
    }

    /**
     * Get local cache file path for an object
     */
    private _getLocalCachePath(connectionHash: string, metadata: ObjectMetadata): string {
        const cacheBasePath = this._localCacheService.getCacheBasePath();
        const cachePath = vscode.Uri.joinPath(cacheBasePath, connectionHash);
        const filePath = this._getObjectFilePath(metadata);
        return path.join(cachePath.fsPath, filePath);
    }

    /**
     * Get Git repository file path for an object
     */
    private _getGitRepoPath(gitRepoPath: string, metadata: ObjectMetadata): string {
        const filePath = this._getObjectFilePath(metadata);
        return path.join(gitRepoPath, filePath);
    }

    /**
     * Get relative file path for an object (matches LocalCacheService structure)
     * Handles both scripting type names AND SQL Server type_desc values
     */
    private _getObjectFilePath(metadata: ObjectMetadata): string {
        const objectType = metadata.metadataTypeName;
        const schema = metadata.schema || "dbo";
        const name = metadata.name;

        // Map both scripting type names AND SQL Server type_desc values
        switch (objectType) {
            // Scripting type names (from ObjectMetadata)
            case "Table":
            // SQL Server type_desc values (from cache metadata)
            case "USER_TABLE":
                return `tables/${schema}.${name}.sql`;

            case "View":
            case "VIEW":
                return `views/${schema}.${name}.sql`;

            case "StoredProcedure":
            case "SQL_STORED_PROCEDURE":
                return `stored-procedures/${schema}.${name}.sql`;

            case "UserDefinedFunction":
            case "SQL_SCALAR_FUNCTION":
            case "SQL_INLINE_TABLE_VALUED_FUNCTION":
            case "SQL_TABLE_VALUED_FUNCTION":
                return `functions/${schema}.${name}.sql`;

            case "Trigger":
            case "SQL_TRIGGER":
                return `triggers/${schema}.${name}.sql`;

            default:
                return `other/${schema}.${name}.sql`;
        }
    }

    /**
     * Find objects that exist in Git repository but not in database (deleted objects)
     */
    private async _findDeletedObjects(
        gitRepoPath: string,
        cacheMetadata: any,
        connectionHash: string,
        credentials: IConnectionInfo,
    ): Promise<DatabaseResourceState[]> {
        const fs = require("fs").promises;
        const deletedObjects: DatabaseResourceState[] = [];

        // Define the folders to scan in the Git repository
        const foldersToScan = [
            { folder: "stored-procedures", type: "SQL_STORED_PROCEDURE" },
            { folder: "views", type: "VIEW" },
            { folder: "functions", type: "SQL_SCALAR_FUNCTION" }, // We'll use a generic type for functions
            { folder: "triggers", type: "SQL_TRIGGER" },
            { folder: "tables", type: "USER_TABLE" },
        ];

        for (const { folder, type } of foldersToScan) {
            const folderPath = path.join(gitRepoPath, folder);

            try {
                // Check if folder exists
                await fs.access(folderPath);

                // Read all .sql files in the folder
                const files = await fs.readdir(folderPath);
                const sqlFiles = files.filter((f: string) => f.endsWith(".sql"));

                for (const file of sqlFiles) {
                    // Parse filename: schema.name.sql
                    const match = file.match(/^(.+)\.(.+)\.sql$/);
                    if (!match) {
                        console.log(`[SourceControl] Skipping invalid filename: ${file}`);
                        continue;
                    }

                    const schema = match[1];
                    const name = match[2];
                    const objectKey = `${schema}.${name}`;

                    // Check if object exists in database cache
                    if (!cacheMetadata.objects[objectKey]) {
                        // Object exists in Git but not in database - it's deleted
                        const metadata: ObjectMetadata = {
                            metadataTypeName: type,
                            schema: schema,
                            name: name,
                            metadataType: 0,
                            urn: objectKey,
                        };

                        const localCachePath = this._getLocalCachePath(connectionHash, metadata);
                        const gitRepoFilePath = path.join(folderPath, file);

                        deletedObjects.push(
                            new DatabaseResourceState(
                                metadata,
                                GitObjectStatus.Deleted,
                                connectionHash,
                                credentials,
                                localCachePath,
                                gitRepoFilePath,
                            ),
                        );

                        console.log(
                            `[SourceControl] Found deleted object: ${schema}.${name} (${type})`,
                        );
                    }
                }
            } catch (error) {
                // Folder doesn't exist or can't be read - skip it
                console.log(`[SourceControl] Skipping folder ${folder}: ${error}`);
            }
        }

        return deletedObjects;
    }

    /**
     * Stage a change
     */
    private async _stageChange(resourceState: DatabaseResourceState): Promise<void> {
        // Move from changes to staged
        this._changesGroup.resourceStates = this._changesGroup.resourceStates.filter(
            (r) => r.resourceUri.toString() !== resourceState.resourceUri.toString(),
        );
        this._stagedGroup.resourceStates = [...this._stagedGroup.resourceStates, resourceState];
    }

    /**
     * Unstage a change
     */
    private async _unstageChange(resourceState: DatabaseResourceState): Promise<void> {
        // Move from staged to changes
        this._stagedGroup.resourceStates = this._stagedGroup.resourceStates.filter(
            (r) => r.resourceUri.toString() !== resourceState.resourceUri.toString(),
        );
        this._changesGroup.resourceStates = [...this._changesGroup.resourceStates, resourceState];
    }

    /**
     * Stage all changes
     */
    private async _stageAllChanges(): Promise<void> {
        this._stagedGroup.resourceStates = [
            ...this._stagedGroup.resourceStates,
            ...this._changesGroup.resourceStates,
        ];
        this._changesGroup.resourceStates = [];
    }

    /**
     * Unstage all changes
     */
    private async _unstageAllChanges(): Promise<void> {
        this._changesGroup.resourceStates = [
            ...this._changesGroup.resourceStates,
            ...this._stagedGroup.resourceStates,
        ];
        this._stagedGroup.resourceStates = [];
    }

    /**
     * Apply staged changes to local Git repository (no commit/push)
     */
    private async _applyToGitRepo(): Promise<void> {
        if (!this._currentDatabase) {
            return;
        }

        const stagedChanges = this._stagedGroup.resourceStates as DatabaseResourceState[];
        if (stagedChanges.length === 0) {
            vscode.window.showWarningMessage("No changes staged to apply.");
            return;
        }

        const { credentials } = this._currentDatabase;

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Applying changes to local Git repository",
                    cancellable: false,
                },
                async (progress) => {
                    // Get Git repository path
                    const gitInfo = await this._gitStatusService.getDatabaseGitInfo(credentials);
                    if (!gitInfo.isLinked || !gitInfo.localPath) {
                        throw new Error("Database is not linked to a Git repository");
                    }

                    // Copy files from local cache to Git repository
                    progress.report({ message: "Copying files...", increment: 0 });
                    for (let i = 0; i < stagedChanges.length; i++) {
                        const change = stagedChanges[i];
                        await this._copyFileToGit(change);
                        progress.report({
                            message: `Copying ${change.label}...`,
                            increment: (100 / stagedChanges.length) * (i + 1),
                        });
                    }

                    progress.report({ message: "Done!", increment: 100 });
                },
            );

            // Clear the Git status cache to get fresh comparison results
            console.log("[SourceControl] Clearing Git status cache after applying changes");
            this._gitStatusService.clearCache(credentials);

            // Clear staged changes and refresh
            this._stagedGroup.resourceStates = [];
            this._sourceControl.inputBox.value = "";
            await this._refreshChanges(undefined);

            vscode.window.showInformationMessage(
                `Successfully applied ${stagedChanges.length} change(s) to local Git repository. Use Git tools to commit and push.`,
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
        }
    }

    /**
     * Copy a file from local cache to Git repository
     */
    private async _copyFileToGit(change: DatabaseResourceState): Promise<void> {
        const fs = require("fs").promises;

        if (change.status === GitObjectStatus.Deleted) {
            // Delete file from Git repository
            try {
                await fs.unlink(change.gitRepoPath);
            } catch (error) {
                // File might not exist, ignore
            }
        } else {
            // Copy file from local cache to Git repository
            const content = await fs.readFile(change.localCachePath, "utf-8");

            // Ensure directory exists
            const dir = path.dirname(change.gitRepoPath);
            await fs.mkdir(dir, { recursive: true });

            // Write file
            await fs.writeFile(change.gitRepoPath, content, "utf-8");
        }
    }

    /**
     * Open diff view for a change
     */
    private async _openDiff(resourceState: DatabaseResourceState): Promise<void> {
        try {
            let leftUri: vscode.Uri;
            let rightUri: vscode.Uri;
            let title: string;

            // Handle different status cases
            switch (resourceState.status) {
                case GitObjectStatus.Added:
                    // Object exists in cache but not in Git - show empty on left, cache on right
                    leftUri = await this._createEmptyFileUri(
                        resourceState.label,
                        "// Object does not exist in Git repository\n",
                    );
                    rightUri = vscode.Uri.file(resourceState.localCachePath);
                    title = `${resourceState.label} (New in Database)`;
                    break;

                case GitObjectStatus.Deleted:
                    // Object exists in Git but not in cache - show Git on left, empty on right
                    leftUri = vscode.Uri.file(resourceState.gitRepoPath);
                    rightUri = await this._createEmptyFileUri(
                        resourceState.label,
                        "// Object has been deleted from database\n",
                    );
                    title = `${resourceState.label} (Deleted from Database)`;
                    break;

                case GitObjectStatus.Modified:
                default:
                    // Object exists in both - show Git on left, cache on right
                    leftUri = vscode.Uri.file(resourceState.gitRepoPath);
                    rightUri = vscode.Uri.file(resourceState.localCachePath);
                    title = `${resourceState.label} (Git ↔ Database)`;
                    break;
            }

            // Open diff view (read-only by default)
            await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
                preview: true,
                preserveFocus: false,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open diff view: ${error}`);
            console.error("[SourceControl] Error opening diff:", error);
        }
    }

    /**
     * Create a temporary empty file URI for diff view
     */
    private async _createEmptyFileUri(label: string, content: string): Promise<vscode.Uri> {
        // Use an untitled document scheme for empty files
        // This creates a virtual document that doesn't exist on disk
        const emptyUri = vscode.Uri.parse(`untitled:${label}.sql`).with({
            scheme: "untitled",
        });

        // Create the document with the placeholder content
        await vscode.workspace.openTextDocument(emptyUri);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(emptyUri, new vscode.Position(0, 0), content);
        await vscode.workspace.applyEdit(edit);

        return emptyUri;
    }

    /**
     * Discard changes (revert to Git version)
     */
    private async _discardChanges(resourceState: DatabaseResourceState): Promise<void> {
        // Check if this is a table - requires special handling
        if (resourceState.metadata.metadataTypeName === "USER_TABLE") {
            await this._discardTableChanges(resourceState);
            return;
        }

        // Show confirmation dialog for non-table objects
        const answer = await vscode.window.showWarningMessage(
            `This will modify the database object "${resourceState.label}" to match the Git repository version. ` +
                `Database changes cannot be undone. Continue?`,
            { modal: true },
            "Continue",
            "Cancel",
        );

        if (answer !== "Continue") {
            return;
        }

        try {
            // Execute the discard operation with progress notification
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Syncing database from Git repository",
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: `Processing ${resourceState.label}...` });

                    // Generate and execute the ALTER/CREATE/DROP script
                    await this._executeDiscardScript(resourceState);

                    progress.report({ message: `Updating local cache...` });

                    // Update local cache file to match Git version
                    await this._updateLocalCacheFile(resourceState);

                    // Clear Git status cache to force refresh
                    this._gitStatusService.clearCache(resourceState.credentials);

                    // Refresh changes
                    await this._refreshChanges(undefined);
                },
            );

            vscode.window.showInformationMessage(
                `Successfully synced ${resourceState.label} from Git repository.`,
            );
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to sync ${resourceState.label}: ${getErrorMessage(error)}`,
            );
            console.error(`[SourceControl] Failed to discard changes:`, error);
        }
    }

    /**
     * Discard table changes with migration script generation, preview, and data loss warnings
     */
    private async _discardTableChanges(resourceState: DatabaseResourceState): Promise<void> {
        const fs = require("fs").promises;

        try {
            // Read database and Git versions
            const databaseSQL = await fs.readFile(resourceState.localCachePath, "utf-8");
            let gitSQL = "";

            if (resourceState.status === GitObjectStatus.Added) {
                // Table exists in database but not in Git - will be dropped
                const answer = await vscode.window.showWarningMessage(
                    `⚠️ WARNING: Data Loss Operation\n\n` +
                        `Table "${resourceState.label}" exists in the database but not in the Git repository.\n\n` +
                        `Discarding this change will DROP THE ENTIRE TABLE and ALL ITS DATA.\n\n` +
                        `This operation CANNOT be undone. Are you sure you want to continue?`,
                    { modal: true },
                    "Preview DROP Script",
                    "Cancel",
                );

                if (answer !== "Preview DROP Script") {
                    return;
                }

                // Generate DROP script
                const fullName = `[${resourceState.metadata.schema || "dbo"}].[${resourceState.metadata.name}]`;
                const dropScript = `-- WARNING: This will DROP the table and ALL data\nDROP TABLE IF EXISTS ${fullName};`;

                // Show preview
                const confirmed = await this._showMigrationScriptPreview(
                    dropScript,
                    resourceState.label,
                    "DROP TABLE",
                );

                if (!confirmed) {
                    return;
                }

                // Execute DROP
                await this._executeTableMigrationScript(resourceState, dropScript);
                return;
            } else if (resourceState.status === GitObjectStatus.Deleted) {
                // Table exists in Git but not in database - will be created
                gitSQL = await fs.readFile(resourceState.gitRepoPath, "utf-8");

                const answer = await vscode.window.showWarningMessage(
                    `Table "${resourceState.label}" exists in the Git repository but not in the database.\n\n` +
                        `Discarding this change will CREATE the table in the database.\n\n` +
                        `Continue?`,
                    { modal: true },
                    "Preview CREATE Script",
                    "Cancel",
                );

                if (answer !== "Preview CREATE Script") {
                    return;
                }

                // Show preview of CREATE script
                const confirmed = await this._showMigrationScriptPreview(
                    gitSQL,
                    resourceState.label,
                    "CREATE TABLE",
                );

                if (!confirmed) {
                    return;
                }

                // Execute CREATE
                await this._executeTableMigrationScript(resourceState, gitSQL);
                return;
            } else {
                // Modified table - generate migration script
                gitSQL = await fs.readFile(resourceState.gitRepoPath, "utf-8");
            }

            // Analyze data loss
            const dataLossSummary = this._tableMigrationService.analyzeDataLoss(
                databaseSQL,
                gitSQL,
            );

            // Show data loss warning if applicable
            if (dataLossSummary.hasDataLoss) {
                const dataLossMessage =
                    this._tableMigrationService.formatDataLossSummary(dataLossSummary);

                const answer = await vscode.window.showWarningMessage(
                    `⚠️ WARNING: Potential Data Loss\n\n` +
                        `Discarding changes to table "${resourceState.label}" may result in data loss:\n\n` +
                        `${dataLossMessage}\n\n` +
                        `This operation CANNOT be undone. Do you want to preview the migration script?`,
                    { modal: true },
                    "Preview Migration Script",
                    "Cancel",
                );

                if (answer !== "Preview Migration Script") {
                    return;
                }
            } else {
                // No data loss, but still show confirmation
                const answer = await vscode.window.showInformationMessage(
                    `Discard changes to table "${resourceState.label}"?\n\n` +
                        `This will modify the table schema to match the Git repository version.\n\n` +
                        `No data loss is expected, but you should preview the migration script.`,
                    { modal: true },
                    "Preview Migration Script",
                    "Cancel",
                );

                if (answer !== "Preview Migration Script") {
                    return;
                }
            }

            // Generate migration script
            const migrationScript = this._tableMigrationService.generateMigrationScript(
                databaseSQL,
                gitSQL,
            );

            // Show preview and get final confirmation
            const confirmed = await this._showMigrationScriptPreview(
                migrationScript,
                resourceState.label,
                "ALTER TABLE",
            );

            if (!confirmed) {
                return;
            }

            // Execute migration script
            await this._executeTableMigrationScript(resourceState, migrationScript);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to discard table changes: ${getErrorMessage(error)}`,
            );
            console.error(`[SourceControl] Failed to discard table changes:`, error);
        }
    }

    /**
     * Update local cache file to match Git repository version
     */
    private async _updateLocalCacheFile(resourceState: DatabaseResourceState): Promise<void> {
        const fs = require("fs").promises;

        if (resourceState.status === GitObjectStatus.Added) {
            // Object exists in database but not in Git - delete from local cache
            try {
                await fs.unlink(resourceState.localCachePath);
                console.log(
                    `[SourceControl] Deleted local cache file: ${resourceState.localCachePath}`,
                );
            } catch (error) {
                // File might not exist, which is fine
                console.log(
                    `[SourceControl] Could not delete local cache file (might not exist): ${resourceState.localCachePath}`,
                );
            }
        } else {
            // Object is Modified or Deleted - copy Git version to local cache
            const gitContent = await fs.readFile(resourceState.gitRepoPath, "utf-8");
            await fs.writeFile(resourceState.localCachePath, gitContent, "utf-8");
            console.log(
                `[SourceControl] Updated local cache file from Git: ${resourceState.localCachePath}`,
            );
        }
    }

    /**
     * Execute the ALTER/CREATE/DROP script to sync database object from Git repository
     */
    private async _executeDiscardScript(resourceState: DatabaseResourceState): Promise<void> {
        const fs = require("fs").promises;

        // Read the Git repository version (only if the file exists in Git)
        // For Added objects (exist in DB but not in Git), we don't need to read the Git file
        let gitContent = "";
        if (resourceState.status !== GitObjectStatus.Added) {
            gitContent = await fs.readFile(resourceState.gitRepoPath, "utf-8");
        }

        // Generate the appropriate script based on object type and status
        const script = this._generateDiscardScript(resourceState, gitContent);

        // Get connection URI for this database
        const connectionUri = await this._getConnectionUri(resourceState.credentials);

        // Execute the script
        console.log(
            `[SourceControl] Executing discard script for ${resourceState.label} (${resourceState.status})`,
        );
        console.log(`[SourceControl] Script:\n${script}`);

        await this._executeQuery(connectionUri, script);

        console.log(
            `[SourceControl] Successfully executed discard script for ${resourceState.label}`,
        );
    }

    /**
     * Show migration script preview in a new editor and get user confirmation
     */
    private async _showMigrationScriptPreview(
        script: string,
        tableName: string,
        operationType: string,
    ): Promise<boolean> {
        // Create a new untitled document with the migration script
        const doc = await vscode.workspace.openTextDocument({
            content: script,
            language: "sql",
        });

        // Show the document in a new editor
        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside,
        });

        // Show confirmation dialog
        const answer = await vscode.window.showWarningMessage(
            `⚠️ Review Migration Script\n\n` +
                `Operation: ${operationType}\n` +
                `Table: ${tableName}\n\n` +
                `Please review the migration script in the editor.\n\n` +
                `This operation CANNOT be undone. Execute the script?`,
            { modal: true },
            "Execute Script",
            "Cancel",
        );

        return answer === "Execute Script";
    }

    /**
     * Execute table migration script with progress notification
     */
    private async _executeTableMigrationScript(
        resourceState: DatabaseResourceState,
        script: string,
    ): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Executing table migration script",
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: `Modifying table ${resourceState.label}...` });

                    // Get connection URI
                    const connectionUri = await this._getConnectionUri(resourceState.credentials);

                    // Execute the migration script
                    console.log(
                        `[SourceControl] Executing table migration script for ${resourceState.label}`,
                    );
                    console.log(`[SourceControl] Script:\n${script}`);

                    await this._executeQuery(connectionUri, script);

                    console.log(
                        `[SourceControl] Successfully executed table migration script for ${resourceState.label}`,
                    );

                    progress.report({ message: `Updating local cache...` });

                    // Update local cache file to match Git version
                    await this._updateLocalCacheFile(resourceState);

                    // Clear Git status cache to force refresh
                    this._gitStatusService.clearCache(resourceState.credentials);

                    // Refresh changes
                    await this._refreshChanges(undefined);
                },
            );

            vscode.window.showInformationMessage(
                `Successfully synced table ${resourceState.label} from Git repository.`,
            );
        } catch (error) {
            throw new Error(`Failed to execute migration script: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Generate ALTER/CREATE/DROP script based on object type and status
     */
    private _generateDiscardScript(
        resourceState: DatabaseResourceState,
        gitContent: string,
    ): string {
        const { metadata, status } = resourceState;
        const objectType = metadata.metadataTypeName;
        const fullName = `[${metadata.schema || "dbo"}].[${metadata.name}]`;

        switch (status) {
            case GitObjectStatus.Modified:
                // Object exists in both database and Git - generate ALTER statement
                return this._generateAlterScript(objectType, fullName, gitContent);

            case GitObjectStatus.Deleted:
                // Object exists in Git but not in database - generate CREATE statement
                return gitContent; // Git file already contains CREATE statement

            case GitObjectStatus.Added:
                // Object exists in database but not in Git - generate DROP statement
                return this._generateDropScript(objectType, fullName);

            default:
                throw new Error(`Unknown status: ${status}`);
        }
    }

    /**
     * Generate ALTER script for modified objects
     */
    private _generateAlterScript(objectType: string, fullName: string, gitContent: string): string {
        // Replace CREATE with ALTER in the Git content
        // This works for views, procedures, functions, and triggers

        let alterScript = gitContent;

        switch (objectType) {
            case "VIEW":
                alterScript = gitContent.replace(/CREATE\s+VIEW/i, "ALTER VIEW");
                break;

            case "SQL_STORED_PROCEDURE":
                alterScript = gitContent.replace(/CREATE\s+PROCEDURE/i, "ALTER PROCEDURE");
                alterScript = alterScript.replace(/CREATE\s+PROC/i, "ALTER PROC");
                break;

            case "SQL_SCALAR_FUNCTION":
            case "SQL_INLINE_TABLE_VALUED_FUNCTION":
            case "SQL_TABLE_VALUED_FUNCTION":
                alterScript = gitContent.replace(/CREATE\s+FUNCTION/i, "ALTER FUNCTION");
                break;

            case "SQL_TRIGGER":
                alterScript = gitContent.replace(/CREATE\s+TRIGGER/i, "ALTER TRIGGER");
                break;

            default:
                throw new Error(`Unsupported object type for ALTER: ${objectType}`);
        }

        // Verify that the replacement worked
        if (alterScript === gitContent) {
            throw new Error(
                `Failed to generate ALTER script for ${fullName}. ` +
                    `Could not find CREATE statement in Git content.`,
            );
        }

        return alterScript;
    }

    /**
     * Generate DROP script for added objects (exist in database but not in Git)
     */
    private _generateDropScript(objectType: string, fullName: string): string {
        switch (objectType) {
            case "VIEW":
                return `DROP VIEW IF EXISTS ${fullName};`;

            case "SQL_STORED_PROCEDURE":
                return `DROP PROCEDURE IF EXISTS ${fullName};`;

            case "SQL_SCALAR_FUNCTION":
            case "SQL_INLINE_TABLE_VALUED_FUNCTION":
            case "SQL_TABLE_VALUED_FUNCTION":
                return `DROP FUNCTION IF EXISTS ${fullName};`;

            case "SQL_TRIGGER":
                return `DROP TRIGGER IF EXISTS ${fullName};`;

            default:
                throw new Error(`Unsupported object type for DROP: ${objectType}`);
        }
    }

    /**
     * Get or create connection URI for the database
     */
    private async _getConnectionUri(credentials: IConnectionInfo): Promise<string> {
        // Check if there's an existing connection
        const existingConnection = this._connectionManager.getConnectionInfo(credentials.server);

        if (existingConnection && existingConnection.connectionId) {
            return existingConnection.connectionId;
        }

        // Create a new connection
        const uri = `mssql-scm://${credentials.server}/${credentials.database}/${Date.now()}`;
        const connected = await this._connectionManager.connect(uri, credentials);

        if (!connected) {
            throw new Error(`Failed to connect to database: ${credentials.database}`);
        }

        return uri;
    }

    /**
     * Execute a SQL query against the database
     * For DDL statements (ALTER, CREATE, DROP), we use query/simpleexecute which may return empty results
     */
    private async _executeQuery(connectionUri: string, query: string): Promise<void> {
        try {
            // Execute the query - DDL statements may not return results
            await this._sqlToolsClient.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    SimpleExecuteResult,
                    void,
                    void
                >("query/simpleexecute"),
                {
                    ownerUri: connectionUri,
                    queryString: query,
                },
            );
        } catch (error) {
            // Check if the error is "Query has no results to return" which is expected for DDL statements
            const errorMessage = getErrorMessage(error);
            if (errorMessage.includes("Query has no results to return")) {
                // This is expected for DDL statements (ALTER, CREATE, DROP) - not an error
                console.log(
                    `[SourceControl] DDL statement executed successfully (no results expected)`,
                );
                return;
            }
            // Re-throw other errors
            throw error;
        }
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
    }

    // QuickDiffProvider implementation (required for source control)
    provideOriginalResource(uri: vscode.Uri): vscode.ProviderResult<vscode.Uri> {
        // Return the Git version of the file for diff
        return undefined; // We'll implement diff separately
    }
}
