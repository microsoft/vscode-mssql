/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface EditDataWebViewState {}

export interface EditDataReducers {}

// Edit Data Shared Interfaces --------------------------------------------------------------------------
export interface DbCellValue {
    displayValue: string;
    isNull: boolean;
    invariantCultureDisplayValue: string;
}

export interface EditCell extends DbCellValue {
    isDirty: boolean;
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

export interface IEditSessionOperationParams {
    ownerUri: string;
}

export interface IEditRowOperationParams extends IEditSessionOperationParams {
    rowId: number;
}

export interface EditCellResult {
    cell: EditCell;
    isRowDirty: boolean;
}

// edit/commit --------------------------------------------------------------------------------
export interface EditCommitParams extends IEditSessionOperationParams {}
export interface EditCommitResult {}

// edit/createRow -----------------------------------------------------------------------------
export interface EditCreateRowParams extends IEditSessionOperationParams {}
export interface EditCreateRowResult {
    defaultValues: string[];
    newRowId: number;
}

// edit/deleteRow -----------------------------------------------------------------------------
export interface EditDeleteRowParams extends IEditRowOperationParams {}
export interface EditDeleteRowResult {}

// edit/dispose -------------------------------------------------------------------------------
export interface EditDisposeParams extends IEditSessionOperationParams {}
export interface EditDisposeResult {}

// edit/initialize ----------------------------------------------------------------------------
export interface EditInitializeFiltering {
    LimitResults?: number | undefined;
}

export interface EditInitializeParams extends IEditSessionOperationParams {
    filters: EditInitializeFiltering;
    objectName: string;
    schemaName: string;
    objectType: string;
    queryString: string;
}

export interface EditInitializeResult {}

// edit/revertCell ----------------------------------------------------------------------------
export interface EditRevertCellParams extends IEditRowOperationParams {
    columnId: number;
}
export interface EditRevertCellResult extends EditCellResult {}

// edit/revertRow -----------------------------------------------------------------------------
export interface EditRevertRowParams extends IEditRowOperationParams {}
export interface EditRevertRowResult {}

// edit/sessionReady Event --------------------------------------------------------------------
export interface EditSessionReadyParams {
    ownerUri: string;
    success: boolean;
    message: string;
}

// edit/updateCell ----------------------------------------------------------------------------
export interface EditUpdateCellParams extends IEditRowOperationParams {
    columnId: number;
    newValue: string;
}

export interface EditUpdateCellResult extends EditCellResult {}

// edit/subset --------------------------------------------------------------------------------
export interface EditSubsetParams extends IEditSessionOperationParams {
    rowStartIndex: number;
    rowCount: number;
}
export interface EditSubsetResult {
    rowCount: number;
    subset: EditRow[];
}
