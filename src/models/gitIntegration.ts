/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Metadata for a Git repository link
 */
export interface GitLinkMetadata {
    /** Git repository URL (HTTPS or SSH) */
    repositoryUrl: string;
    /** Branch name */
    branch: string;
    /** ISO timestamp when the link was created */
    linkedAt: string;
    /** ISO timestamp of last sync (optional) */
    lastSyncAt?: string;
    /** Connection information */
    connectionInfo: {
        server: string;
        database: string;
    };
}

/**
 * Status of a Git repository link
 */
export interface GitLinkStatus {
    /** Whether the database is linked to a Git repository */
    isLinked: boolean;
    /** Link metadata (if linked) */
    metadata?: GitLinkMetadata;
    /** Local repository path */
    localPath?: string;
}

/**
 * Result of Git URL validation
 */
export interface GitUrlValidationResult {
    /** Whether the URL is valid */
    isValid: boolean;
    /** Error message if invalid */
    error?: string;
    /** Detected URL type (https or ssh) */
    type?: "https" | "ssh";
}

/**
 * Result of branch fetching operation
 */
export interface GitBranchFetchResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** List of branch names */
    branches?: string[];
    /** Error message if failed */
    error?: string;
}

/**
 * Result of repository cloning operation
 */
export interface GitCloneResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Local path where repository was cloned */
    localPath?: string;
    /** Error message if failed */
    error?: string;
}
