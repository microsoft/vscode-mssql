/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface TableExplorerDataColumn {
    originalIndex: number;
}

interface TableExplorerCellChange {
    rowId: number;
}

export function isTableExplorerDataColumn(column: unknown): column is TableExplorerDataColumn {
    return (
        typeof column === "object" &&
        column !== null &&
        typeof (column as Partial<TableExplorerDataColumn>).originalIndex === "number"
    );
}

export function hasPendingChangesForRow(
    rowId: number,
    cellChanges: Iterable<TableExplorerCellChange>,
    deletedRows: ReadonlySet<number>,
    newRowIds: ReadonlySet<number>,
): boolean {
    if (deletedRows.has(rowId) || newRowIds.has(rowId)) {
        return true;
    }

    for (const change of cellChanges) {
        if (change.rowId === rowId) {
            return true;
        }
    }

    return false;
}
