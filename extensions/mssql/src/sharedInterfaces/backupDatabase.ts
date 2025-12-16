/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";

export interface BackupDatabaseState {
    loadState?: ApiStatus;
    errorMessage?: string;
    databaseNode: BackupDatabaseNode;
}

export interface BackupDatabaseNode {
    label: string;
    nodePath: string;
    nodeStatus: string;
}

export interface BackupDatabaseReducers {
    /**
     * Gets the database information associated with the backup operation
     */
    getDatabase: {};
}

export interface BackupDatabaseProvider {
    /**
     * Gets the database information associated with the backup operation
     */
    getDatabase(): void;
}
