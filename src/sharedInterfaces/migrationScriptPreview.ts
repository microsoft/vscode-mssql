/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * State for the migration script preview webview
 */
export interface MigrationScriptPreviewState {
    /**
     * The SQL migration script to preview
     */
    script: string;

    /**
     * The name of the table being migrated
     */
    tableName: string;

    /**
     * The type of migration operation (DROP TABLE, CREATE TABLE, ALTER TABLE)
     */
    operationType: string;

    /**
     * Whether the operation has potential data loss
     */
    hasDataLoss: boolean;
}

/**
 * Reducers for the migration script preview webview
 */
export interface MigrationScriptPreviewReducers {
    /**
     * User clicked the Execute Script button
     */
    executeScript: () => void;

    /**
     * User clicked the Cancel button
     */
    cancel: () => void;
}
