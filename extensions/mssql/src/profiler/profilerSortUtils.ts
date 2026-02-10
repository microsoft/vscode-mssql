/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SortDirection, SortState } from "./profilerTypes";

/**
 * Comparator for sorting profiler grid rows by a specific field.
 * Handles string, number, and null/undefined comparisons.
 *
 * Null/undefined/empty values are always pushed to the end
 * regardless of sort direction.
 *
 * @param a - First row
 * @param b - Second row
 * @param sortField - The field name to sort by
 * @param sortDir - The sort direction (ASC or DESC)
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
export function profilerSortComparator(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    sortField: string,
    sortDir: SortDirection,
): number {
    const valA = a[sortField];
    const valB = b[sortField];

    // Handle null/undefined — push them to the end regardless of direction
    const aIsEmpty = valA === null || valA === undefined || valA === "";
    const bIsEmpty = valB === null || valB === undefined || valB === "";
    if (aIsEmpty && bIsEmpty) {
        return 0;
    }
    if (aIsEmpty) {
        return 1;
    }
    if (bIsEmpty) {
        return -1;
    }

    let result: number;
    if (typeof valA === "number" && typeof valB === "number") {
        result = valA - valB;
    } else {
        // String comparison (case-insensitive with numeric awareness)
        result = String(valA).localeCompare(String(valB), undefined, {
            sensitivity: "base",
            numeric: true,
        });
    }

    return sortDir === SortDirection.ASC ? result : -result;
}

/**
 * Creates a DataView sort function for the given sort state.
 * If sort is null, returns a comparator that restores natural
 * insertion order (by eventNumber ascending).
 *
 * @param sort - The current sort state, or null for natural order
 * @returns A comparator function suitable for DataView.sort()
 */
export function createDataViewSortFn(
    sort: SortState | null,
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
    if (!sort) {
        // Restore natural insertion order
        return (a, b) => {
            const numA = a["eventNumber"] as number;
            const numB = b["eventNumber"] as number;
            return numA - numB;
        };
    }

    return (a, b) => profilerSortComparator(a, b, sort.field, sort.direction);
}

/**
 * Computes the next sort state when a column header is clicked.
 * Implements the cycle: unsorted → ASC → DESC → unsorted.
 * Only one column can be sorted at a time.
 *
 * @param currentSort - The current sort state (null if no sort active)
 * @param clickedField - The field of the column that was clicked
 * @returns The new sort state, or null if sort should be cleared
 */
export function getNextSortState(
    currentSort: SortState | null,
    clickedField: string,
): SortState | null {
    if (!currentSort || currentSort.field !== clickedField) {
        // Different column or no sort — start ascending
        return { field: clickedField, direction: SortDirection.ASC };
    }

    if (currentSort.direction === SortDirection.ASC) {
        // Same column, was ASC → switch to DESC
        return { field: clickedField, direction: SortDirection.DESC };
    }

    // Same column, was DESC → clear sort
    return null;
}
