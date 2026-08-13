/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditCell, EditRow } from "../sharedInterfaces/tableExplorer";

/**
 * Removes locally tracked edits that the edit service reports as clean.
 * The service performs the SQL-type-aware conversion and comparison, so its dirty state is
 * authoritative for values such as NULL, dates, and culture-specific numeric representations.
 */
export function removeCleanCellChanges(
    rows: EditRow[],
    cellChanges: Map<string, unknown>,
): boolean {
    let changed = false;

    for (const row of rows) {
        row.cells.forEach((cell, columnIndex) => {
            if ((cell as EditCell).isDirty === false) {
                changed = cellChanges.delete(`${row.id}-${columnIndex}`) || changed;
            }
        });
    }

    return changed;
}
