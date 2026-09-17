/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiffEntry } from "vscode-mssql";
import { SchemaCompareDifferenceUpdate } from "../../../sharedInterfaces/schemaCompare";

/**
 * Returns a copy of `differences` with the `included` flag of each listed id replaced. Rows that
 * are not listed keep their identity so cached scripts and memoized rows are preserved.
 */
export function applyInclusionUpdates(
    differences: DiffEntry[],
    updates: readonly SchemaCompareDifferenceUpdate[],
): DiffEntry[] {
    if (updates.length === 0) {
        return differences;
    }

    const includedById = new Map(updates.map((update) => [update.id, update.included]));
    return differences.map((difference, id) => {
        const included = includedById.get(id);
        return included === undefined || included === difference.included
            ? difference
            : { ...difference, included };
    });
}

/**
 * Replaces one row with its detailed version while keeping the `included` value currently
 * displayed, so a details response can never undo a pending checkbox change.
 */
export function applyDifferenceDetails(
    differences: DiffEntry[],
    id: number,
    details: DiffEntry,
): DiffEntry[] {
    const current = differences[id];
    if (!current) {
        return differences;
    }

    return differences.map((difference, index) =>
        index === id ? { ...details, included: current.included } : difference,
    );
}
