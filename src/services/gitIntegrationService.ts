/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { simpleGit, SimpleGit } from "simple-git";
import * as crypto from "crypto";
import {
    GitLinkMetadata,
    GitLinkStatus,
    GitUrlValidationResult,
    GitBranchFetchResult,
    GitCloneResult,
} from "../models/gitIntegration";
import { IConnectionInfo } from "vscode-mssql";

/**
 * Service for managing Git repository integration with database objects
 */
export class GitIntegrationService {
    private _repoBasePath: vscode.Uri;

    constructor(context: vscode.ExtensionContext) {
        // Use globalStoragePath/LocalRepoCache for repository storage
        this._repoBasePath = vscode.Uri.joinPath(context.globalStorageUri, "LocalRepoCache");
    }

    /**
     * Initialize the service (create storage directories if needed)
     */
    public async initialize(): Promise<void> {
        try {
            await fs.mkdir(this._repoBasePath.fsPath, { recursive: true });
        } catch (error) {
            console.error("[GitIntegration] Failed to create storage directory:", error);
            throw error;
        }
    }

    /**
     * Validate a Git repository URL
     */
    public validateGitUrl(url: string): GitUrlValidationResult {
        if (!url || url.trim().length === 0) {
            return {
                isValid: false,
                error: "URL cannot be empty",
            };
        }

        const trimmedUrl = url.trim();

        // HTTPS format: https://github.com/user/repo.git or https://github.com/user/repo
        const httpsRegex = /^https:\/\/[^\s]+\.[^\s]+(\/[^\s]+)*\.git$/i;
        const httpsRegexNoGit = /^https:\/\/[^\s]+\.[^\s]+(\/[^\s]+)+$/i;

        // SSH format: git@github.com:user/repo.git or git@github.com:user/repo
        const sshRegex = /^git@[^\s]+:[^\s]+\.git$/i;
        const sshRegexNoGit = /^git@[^\s]+:[^\s]+$/i;

        if (httpsRegex.test(trimmedUrl) || httpsRegexNoGit.test(trimmedUrl)) {
            return {
                isValid: true,
                type: "https",
            };
        }

        if (sshRegex.test(trimmedUrl) || sshRegexNoGit.test(trimmedUrl)) {
            return {
                isValid: true,
                type: "ssh",
            };
        }

        return {
            isValid: false,
            error: "Invalid Git URL format. Expected HTTPS (https://github.com/user/repo.git) or SSH (git@github.com:user/repo.git)",
        };
    }

    /**
     * Fetch remote branches from a Git repository
     */
    public async fetchRemoteBranches(url: string): Promise<GitBranchFetchResult> {
        try {
            const git: SimpleGit = simpleGit();

            // Use ls-remote to get branches without cloning
            const result = await git.listRemote(["--heads", url]);

            if (!result) {
                return {
                    success: false,
                    error: "No branches found in repository",
                };
            }

            // Parse the output to extract branch names
            // Format: <hash>\trefs/heads/<branch-name>
            const branches = result
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((line) => {
                    const match = line.match(/refs\/heads\/(.+)$/);
                    return match ? match[1] : null;
                })
                .filter((branch): branch is string => branch !== null);

            if (branches.length === 0) {
                return {
                    success: false,
                    error: "No branches found in repository",
                };
            }

            return {
                success: true,
                branches,
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to fetch branches: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * Clone a Git repository to local storage
     */
    public async cloneRepository(
        url: string,
        branch: string,
        credentials: IConnectionInfo,
    ): Promise<GitCloneResult> {
        try {
            const connectionHash = this.generateConnectionHash(credentials);
            const targetPath = vscode.Uri.joinPath(this._repoBasePath, connectionHash);

            // Check if directory already exists
            try {
                await fs.access(targetPath.fsPath);
                // Directory exists, remove it first
                await fs.rm(targetPath.fsPath, { recursive: true, force: true });
            } catch {
                // Directory doesn't exist, which is fine
            }

            // Create the target directory
            await fs.mkdir(targetPath.fsPath, { recursive: true });

            // Clone the repository (shallow clone of specific branch)
            const git: SimpleGit = simpleGit();
            await git.clone(url, targetPath.fsPath, [
                "--branch",
                branch,
                "--depth",
                "1",
                "--single-branch",
            ]);

            // Save metadata
            const metadata: GitLinkMetadata = {
                repositoryUrl: url,
                branch,
                linkedAt: new Date().toISOString(),
                connectionInfo: {
                    server: credentials.server,
                    database: credentials.database,
                },
            };

            await this.saveMetadata(connectionHash, metadata);

            return {
                success: true,
                localPath: targetPath.fsPath,
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * Get the link status for a database connection
     */
    public async getLinkStatus(credentials: IConnectionInfo): Promise<GitLinkStatus> {
        const connectionHash = this.generateConnectionHash(credentials);
        const metadata = await this.readMetadata(connectionHash);

        if (!metadata) {
            return {
                isLinked: false,
            };
        }

        const localPath = vscode.Uri.joinPath(this._repoBasePath, connectionHash);

        return {
            isLinked: true,
            metadata,
            localPath: localPath.fsPath,
        };
    }

    /**
     * Unlink a database from its Git repository
     */
    public async unlinkRepository(credentials: IConnectionInfo): Promise<void> {
        const connectionHash = this.generateConnectionHash(credentials);
        const targetPath = vscode.Uri.joinPath(this._repoBasePath, connectionHash);

        try {
            // Remove the repository directory
            await fs.rm(targetPath.fsPath, { recursive: true, force: true });
        } catch (error) {
            console.error("[GitIntegration] Failed to unlink repository:", error);
            throw error;
        }
    }

    /**
     * Generate a deterministic hash for a connection (same as LocalCacheService)
     */
    private generateConnectionHash(credentials: IConnectionInfo): string {
        const hashInput = `${credentials.server}|${credentials.database}|${credentials.user || "integrated"}`;
        return crypto.createHash("sha256").update(hashInput).digest("hex").substring(0, 16);
    }

    /**
     * Save metadata to disk
     */
    private async saveMetadata(connectionHash: string, metadata: GitLinkMetadata): Promise<void> {
        const metadataPath = vscode.Uri.joinPath(
            this._repoBasePath,
            connectionHash,
            "metadata.json",
        );

        try {
            await fs.writeFile(metadataPath.fsPath, JSON.stringify(metadata, null, 2), "utf8");
        } catch (error) {
            console.error("[GitIntegration] Failed to save metadata:", error);
            throw error;
        }
    }

    /**
     * Read metadata from disk
     */
    private async readMetadata(connectionHash: string): Promise<GitLinkMetadata | null> {
        const metadataPath = vscode.Uri.joinPath(
            this._repoBasePath,
            connectionHash,
            "metadata.json",
        );

        try {
            const content = await fs.readFile(metadataPath.fsPath, "utf8");
            return JSON.parse(content) as GitLinkMetadata;
        } catch {
            return null;
        }
    }
}
