/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";

export interface IEditSessionOperationParams {
    ownerUri: string;
}

export interface EditInitializeFiltering {
    LimitResults?: number | undefined;
}

export enum EditRowState {
    clean = 0,
    dirtyInsert = 1,
    dirtyDelete = 2,
    dirtyUpdate = 3,
}

export interface EditRow {
    cells: DbCellValue[];
    id: number;
    isDirty: boolean;
    state: EditRowState;
}

export interface DbCellValue {
    displayValue: string;
    isNull: boolean;
    invariantCultureDisplayValue: string;
}

export interface IEditRowOperationParams extends IEditSessionOperationParams {
    rowId: number;
}

export interface EditCell extends DbCellValue {
    isDirty: boolean;
}
export interface EditCellResult {
    cell: EditCell;
    isRowDirty: boolean;
}

export interface EditReferencedTableInfo {
    schemaName: string;
    tableName: string;
    fullyQualifiedName: string;
    foreignKeyName: string;
    sourceColumns: string[];
    ReferencedColumns: string[];
}

//#region edit/initialize

export interface EditInitializeParams extends IEditSessionOperationParams {
    filters: EditInitializeFiltering;
    objectName: string;
    schemaName: string;
    objectType: string;
    queryString: string;
}

export interface EditInitializeResult {}

//#endregion

//#region edit/sessionReady Event

export interface EditSessionReadyParams {
    ownerUri: string;
    success: boolean;
    message: string;
}

//#endregion

//#region edit/subset

export interface EditSubsetParams extends IEditSessionOperationParams {
    rowStartIndex: number;
    rowCount: number;
}

export interface EditColumnInfo {
    name: string;
    isEditable: boolean;
    isNullable?: boolean;
}

export interface EditSubsetResult {
    rowCount: number;
    subset: EditRow[];
    columnInfo: EditColumnInfo[];
}

//#endregion

//#region edit/commit

export interface EditCommitParams extends IEditSessionOperationParams {}

export interface EditCommitResult {}

//#endregion

//#region edit/createRow

export interface EditCreateRowParams extends IEditSessionOperationParams {}

export interface EditCreateRowResult {
    defaultValues: string[];
    newRowId: number;
    row: EditRow;
}

//#endregion

//#region edit/deleteRow

export interface EditDeleteRowParams extends IEditRowOperationParams {}

export interface EditDeleteRowResult {}

//#endregion

//#region edit/revertRow

export interface EditRevertRowParams extends IEditRowOperationParams {}

export interface EditRevertRowResult {
    row: EditRow;
}

//#endregion

//#region edit/updateCell

export interface EditUpdateCellParams extends IEditRowOperationParams {
    columnId: number;
    newValue: string;
}

export interface EditUpdateCellResult extends EditCellResult {}

//#endregion

//#region edit/revertCell

export interface EditRevertCellParams extends IEditRowOperationParams {
    columnId: number;
}

export interface EditRevertCellResult extends EditCellResult {}

//#endregion

//#region edit/dispose

export interface EditDisposeParams extends IEditSessionOperationParams {}

export interface EditDisposeResult {}

//#endregion

//#region edit/script

export interface EditScriptParams extends IEditSessionOperationParams {}

export interface EditScriptResult {
    scripts: string[];
}

//#endregion

export interface TableExplorerWebViewState {
    tableName: string;
    databaseName: string;
    serverName: string;
    schemaName?: string;
    connectionProfile?: any;
    loadStatus: ApiStatus;
    ownerUri: string;
    resultSet: EditSubsetResult | undefined;
    currentRowCount: number; // Track the user's selected row count for data loading
    newRows: EditRow[]; // Track newly created rows that haven't been committed yet
    updateScript?: string; // SQL script generated from pending changes
    showScriptPane: boolean; // Whether to show the script pane
    currentPage?: number; // Track the current page number in the data grid
    failedCells?: string[]; // Track cells that failed to update (format: "rowId-columnId")
    originalCellValues?: Map<string, DbCellValue>; // Cache original cell values for reliable revert (key: "rowId-columnId")
}

export interface TableExplorerContextProps {
    commitChanges: () => void;
    loadSubset: (rowCount: number) => void;
    createRow: () => void;
    deleteRow: (rowId: number) => void;
    updateCell: (rowId: number, columnId: number, newValue: string) => void;
    revertCell: (rowId: number, columnId: number) => void;
    revertRow: (rowId: number) => void;
    generateScript: () => void;
    openScriptInEditor: () => void;
    copyScriptToClipboard: () => void;
    toggleScriptPane: () => void;
    setCurrentPage: (pageNumber: number) => void;
}

export interface TableExplorerReducers {
    commitChanges: {};
    loadSubset: { rowCount: number };
    createRow: {};
    deleteRow: { rowId: number };
    updateCell: { rowId: number; columnId: number; newValue: string };
    revertCell: { rowId: number; columnId: number };
    revertRow: { rowId: number };
    generateScript: {};
    openScriptInEditor: {};
    copyScriptToClipboard: {};
    toggleScriptPane: {};
    setCurrentPage: { pageNumber: number };
}
