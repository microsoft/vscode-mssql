/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellUpdateAcknowledgement } from "../sharedInterfaces/tableExplorer";

/**
 * Removes locally tracked edits whose matching request the edit service reports as clean.
 * The service performs the SQL-type-aware conversion and comparison, so its dirty state is
 * authoritative for values such as NULL, dates, and culture-specific numeric representations.
 */
export function removeAcknowledgedCleanCellChanges<T extends { requestId: number }>(
    acknowledgements: Record<string, CellUpdateAcknowledgement> | undefined,
    cellChanges: Map<string, T>,
): boolean {
    let changed = false;

    for (const [cellKey, acknowledgement] of Object.entries(acknowledgements ?? {})) {
        const trackedChange = cellChanges.get(cellKey);
        if (!acknowledgement.isDirty && trackedChange?.requestId === acknowledgement.requestId) {
            changed = cellChanges.delete(cellKey) || changed;
        }
    }

    return changed;
}
