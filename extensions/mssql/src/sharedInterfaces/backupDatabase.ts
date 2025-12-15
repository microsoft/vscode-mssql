/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { ApiStatus } from "./webview";

export interface BackupDatabaseWebviewState {
    loadState?: ApiStatus;
    errorMessage?: string;
    databaseNode: TreeNodeInfo;
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
