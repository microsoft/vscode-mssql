/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface EditDataWebViewState {
    ownerUri: string;
    schemaName: string;
    objectName: string;
    objectType: string;
    queryString: string;
    subsetResult: EditSubsetResult;
    createRowResult: EditCreateRowResult;
    revertCellResult: EditRevertCellResult;
    revertRowResult: EditRevertRowResult;
    updateCellResult: EditUpdateCellResult;
}

export interface EditDataReducers {
    /**
     * Creates a new table row in the database table being edited.
     */
    createRow: {
        ownerUri: string;
    };
    /**
     * Deletes a table row from the database table being edited.
     */
    deleteRow: {
        ownerUri: string;
        rowId: number;
    };
    /**
     * Disposes of the edit session.
     */
    dispose: {
        ownerUri: string;
    };
    /**
     * Reverts a table cell in the database table being edited to its original value.
     */
    revertCell: {
        ownerUri: string;
        rowId: number;
        columnId: number;
    };
    /**
     * Reverts a table row in the database table being edited to its original values.
     */
    revertRow: {
        ownerUri: string;
        rowId: number;
    };
    /**
     * Gets a subset of the table rows from the database table being edited.
     */
    subset: {
        ownerUri: string;
        rowStartIndex: number;
        rowCount: number;
    };
    /**
     * Updates a table cell in the database table being edited.
     */
    updateCell: {
        ownerUri: string;
        rowId: number;
        columnId: number;
        newValue: string;
    };
    /**
     * Commits the changes made to the database table being edited.
     */
    commit: {
        ownerUri: string;
    };
}

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
