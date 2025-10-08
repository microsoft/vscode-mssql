/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { IConnectionInfo, ObjectMetadata } from "vscode-mssql";
import { GitIntegrationService } from "../services/gitIntegrationService";
import { LocalCacheService } from "../services/localCacheService";
import { GitStatusService } from "../services/gitStatusService";
import { GitObjectStatus } from "../models/gitStatus";

/**
 * Represents a database object change in the source control view
 */
export class DatabaseResourceState implements vscode.SourceControlResourceState {
    public readonly resourceUri: vscode.Uri;
    public readonly decorations?: vscode.SourceControlResourceDecorations;

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

    constructor(
        private _gitIntegrationService: GitIntegrationService,
        private _localCacheService: LocalCacheService,
        private _gitStatusService: GitStatusService,
    ) {
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

        // Load changes
        await this._refreshChanges();
    }

    /**
     * Refresh the list of changes
     */
    private async _refreshChanges(): Promise<void> {
        if (!this._currentDatabase) {
            console.log("[SourceControl] No current database");
            return;
        }

        const { credentials, connectionHash } = this._currentDatabase;

        // Get all cached objects
        const cacheMetadata = await this._localCacheService.getCacheMetadata(credentials);
        console.log(
            `[SourceControl] Cache metadata:`,
            cacheMetadata ? `${Object.keys(cacheMetadata.objects).length} objects` : "null",
        );
        if (!cacheMetadata) {
            this._changesGroup.resourceStates = [];
            return;
        }

        // Get Git repository path
        const gitInfo = await this._gitStatusService.getDatabaseGitInfo(credentials);
        console.log(
            `[SourceControl] Git info: isLinked=${gitInfo.isLinked}, localPath=${gitInfo.localPath}`,
        );
        if (!gitInfo.isLinked || !gitInfo.localPath) {
            this._changesGroup.resourceStates = [];
            return;
        }

        // Check status of each object
        const changes: DatabaseResourceState[] = [];
        let checkedCount = 0;
        let sampleLogged = false;
        for (const objKey of Object.keys(cacheMetadata.objects)) {
            const obj = cacheMetadata.objects[objKey];
            const metadata: ObjectMetadata = {
                metadataTypeName: obj.type,
                schema: obj.schema,
                name: obj.name,
                metadataType: 0, // Not used for comparison
                urn: `${obj.schema}.${obj.name}`, // URN for the object
            };

            const statusInfo = await this._gitStatusService.getObjectStatus(credentials, metadata);
            checkedCount++;

            // Log first few objects for debugging
            if (!sampleLogged && checkedCount <= 3) {
                console.log(
                    `[SourceControl] Sample ${checkedCount}: ${obj.schema}.${obj.name} (${obj.type}) - ${statusInfo.status}`,
                );
                if (checkedCount === 3) {
                    sampleLogged = true;
                }
            }

            // Only include objects with changes
            if (
                statusInfo.status !== GitObjectStatus.InSync &&
                statusInfo.status !== GitObjectStatus.Unknown
            ) {
                console.log(
                    `[SourceControl] Found change: ${obj.schema}.${obj.name} - ${statusInfo.status}`,
                );
                const localCachePath = this._getLocalCachePath(connectionHash, metadata);
                const gitRepoPath = this._getGitRepoPath(gitInfo.localPath, metadata);

                changes.push(
                    new DatabaseResourceState(
                        metadata,
                        statusInfo.status,
                        connectionHash,
                        credentials,
                        localCachePath,
                        gitRepoPath,
                    ),
                );
            }
        }

        console.log(
            `[SourceControl] Checked ${checkedCount} objects, found ${changes.length} changes`,
        );

        // Update changes group (exclude staged items)
        const stagedUris = new Set(
            this._stagedGroup.resourceStates.map((r) => r.resourceUri.toString()),
        );
        this._changesGroup.resourceStates = changes.filter(
            (c) => !stagedUris.has(c.resourceUri.toString()),
        );

        console.log(
            `[SourceControl] Displaying ${this._changesGroup.resourceStates.length} changes (${this._stagedGroup.resourceStates.length} staged)`,
        );

        // Update count badge
        this._sourceControl.count = changes.length;
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
            await this._refreshChanges();

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
        const leftUri = vscode.Uri.file(resourceState.gitRepoPath).with({
            scheme: "file",
        });
        const rightUri = vscode.Uri.file(resourceState.localCachePath).with({
            scheme: "file",
        });

        const title = `${resourceState.label} (Git ↔ Database)`;

        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
    }

    /**
     * Discard changes (revert to Git version)
     */
    private async _discardChanges(resourceState: DatabaseResourceState): Promise<void> {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to discard changes to ${resourceState.label}? This will revert the local cache to the Git version.`,
            { modal: true },
            "Discard Changes",
        );

        if (answer !== "Discard Changes") {
            return;
        }

        try {
            const fs = require("fs").promises;

            // Copy Git version to local cache
            const gitContent = await fs.readFile(resourceState.gitRepoPath, "utf-8");
            await fs.writeFile(resourceState.localCachePath, gitContent, "utf-8");

            // Refresh changes
            await this._refreshChanges();

            vscode.window.showInformationMessage(`Discarded changes to ${resourceState.label}.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to discard changes: ${error}`);
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
