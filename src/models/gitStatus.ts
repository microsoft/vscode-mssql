/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Git status for a database object
 */
export enum GitObjectStatus {
    /** Object is in sync with Git repository */
    InSync = "InSync",
    /** Object has been modified compared to Git repository */
    Modified = "Modified",
    /** Object exists locally but not in Git repository */
    Added = "Added",
    /** Object exists in Git repository but not locally */
    Deleted = "Deleted",
    /** Database is not linked to a Git repository */
    Untracked = "Untracked",
    /** Git status is unknown or not yet determined */
    Unknown = "Unknown",
}

/**
 * Git status information for a database object
 */
export interface GitObjectStatusInfo {
    /** The status of the object */
    status: GitObjectStatus;
    /** The path to the object in the Git repository (if applicable) */
    gitPath?: string;
    /** The local cached content (if applicable) */
    localContent?: string;
    /** The Git repository content (if applicable) */
    gitContent?: string;
}

/**
 * Git link information for a database
 */
export interface DatabaseGitInfo {
    /** Whether the database is linked to a Git repository */
    isLinked: boolean;
    /** Repository URL (if linked) */
    repositoryUrl?: string;
    /** Branch name (if linked) */
    branch?: string;
    /** Last sync timestamp (if linked) */
    lastSyncAt?: string;
    /** Local repository path */
    localPath?: string;
}
