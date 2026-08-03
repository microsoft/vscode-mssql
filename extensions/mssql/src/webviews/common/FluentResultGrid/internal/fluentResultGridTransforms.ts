/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColumnFilterMap,
    DbCellValue,
    SortProperties,
} from "../../../../sharedInterfaces/queryResult";
import type {
    FluentResultGridFilterListItem,
    FluentResultGridFilterValue,
} from "./fluentResultGridOverlays";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";
import type { SourceRow } from "./fluentResultGridControllerTypes";

export type FluentResultGridSortState = {
    columnId: string;
    direction: SortProperties;
};

export function getFluentResultGridCellFilterValue(
    row: readonly DbCellValue[],
    columnId: string,
): FluentResultGridFilterValue {
    const columnIndex = Number(columnId);
    if (!Number.isInteger(columnIndex)) {
        return undefined;
    }

    const value = row[columnIndex];
    if (!value || value.isNull) {
        return undefined;
    }

    const displayValue = value.displayValue ?? "";
    return displayValue.trim() === "" ? "" : displayValue;
}

export function normalizeStoredFluentResultGridFilterValue(
    value: unknown,
): FluentResultGridFilterValue {
    return value === null || value === undefined ? undefined : String(value);
}

function compareFluentResultGridCellValues(
    a: FluentResultGridFilterValue,
    b: FluentResultGridFilterValue,
): number {
    const numA = Number(a);
    const numB = Number(b);
    const isANumber = a !== undefined && a !== "" && !Number.isNaN(numA);
    const isBNumber = b !== undefined && b !== "" && !Number.isNaN(numB);

    if (a === undefined || b === undefined) {
        return a === b ? 0 : a === undefined ? -1 : 1;
    }

    if (isANumber || isBNumber) {
        if (isANumber && isBNumber) {
            return numA === numB ? 0 : numA > numB ? 1 : -1;
        }

        return isANumber ? -1 : 1;
    }

    return a.localeCompare(b);
}

export function hasActiveFluentResultGridFilters(filters: ColumnFilterMap): boolean {
    return Object.values(filters).some(
        (filterState) => (filterState.filterValues?.length ?? 0) > 0,
    );
}

export function normalizeFluentResultGridSelectedFilterValues(
    filterValues: FluentResultGridFilterValue[],
    availableItems?: readonly { value: FluentResultGridFilterValue }[],
): FluentResultGridFilterValue[] {
    return availableItems && filterValues.length === availableItems.length ? [] : filterValues;
}

function applyFluentResultGridTransformsCore<TRow>({
    rows,
    getCells,
    filters,
    sort,
}: {
    rows: readonly TRow[];
    getCells: (row: TRow) => readonly DbCellValue[];
    filters: ColumnFilterMap;
    sort?: FluentResultGridSortState;
}): TRow[] {
    let transformedRows = [...rows];

    for (const [columnId, filterState] of Object.entries(filters)) {
        const filterValues = filterState.filterValues?.map(
            normalizeStoredFluentResultGridFilterValue,
        );
        if (!filterValues?.length) {
            continue;
        }

        const selectedValues = new Set<FluentResultGridFilterValue>(filterValues);
        transformedRows = transformedRows.filter((row) =>
            selectedValues.has(getFluentResultGridCellFilterValue(getCells(row), columnId)),
        );
    }

    if (sort && sort.direction !== "NONE") {
        const sortMultiplier = sort.direction === "ASC" ? 1 : -1;
        transformedRows.sort(
            (a, b) =>
                compareFluentResultGridCellValues(
                    getFluentResultGridCellFilterValue(getCells(a), sort.columnId),
                    getFluentResultGridCellFilterValue(getCells(b), sort.columnId),
                ) * sortMultiplier,
        );
    }

    return transformedRows;
}

export function applyFluentResultGridTransforms({
    rows,
    filters,
    sort,
}: {
    rows: readonly DbCellValue[][];
    filters: ColumnFilterMap;
    sort?: FluentResultGridSortState;
}): DbCellValue[][] {
    return applyFluentResultGridTransformsCore({
        rows,
        getCells: (row) => row,
        filters,
        sort,
    });
}

export function applyFluentResultGridTransformsToSourceRows({
    rows,
    filters,
    sort,
}: {
    rows: readonly SourceRow[];
    filters: ColumnFilterMap;
    sort?: FluentResultGridSortState;
}): SourceRow[] {
    return applyFluentResultGridTransformsCore({
        rows,
        getCells: (row) => row.cells,
        filters,
        sort,
    });
}

export function getFluentResultGridFilterDisplayText(
    value: FluentResultGridFilterValue,
    strings: FluentResultGridStrings,
): string {
    if (value === undefined) {
        return strings.filter.nullValue;
    }

    if (value === "") {
        return strings.filter.blankValue;
    }

    return value;
}

export function buildFluentResultGridFilterItems({
    rows,
    columnId,
    strings,
}: {
    rows: readonly DbCellValue[][];
    columnId: string;
    strings: FluentResultGridStrings;
}): FluentResultGridFilterListItem[] {
    const uniqueValues = new Map<FluentResultGridFilterValue, string>();
    for (const row of rows) {
        const value = getFluentResultGridCellFilterValue(row, columnId);
        if (!uniqueValues.has(value)) {
            uniqueValues.set(value, getFluentResultGridFilterDisplayText(value, strings));
        }
    }

    const nullEntries: Array<[FluentResultGridFilterValue, string]> = [];
    const blankEntries: Array<[FluentResultGridFilterValue, string]> = [];
    const otherEntries: Array<[FluentResultGridFilterValue, string]> = [];

    uniqueValues.forEach((displayText, value) => {
        if (value === undefined) {
            nullEntries.push([value, displayText]);
        } else if (value === "") {
            blankEntries.push([value, displayText]);
        } else {
            otherEntries.push([value, displayText]);
        }
    });
    otherEntries.sort((a, b) => a[1].localeCompare(b[1]));

    return [...nullEntries, ...blankEntries, ...otherEntries].map(
        ([value, displayText], index) => ({
            value,
            displayText,
            index,
        }),
    );
}
