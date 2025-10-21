/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISlickRange } from "../../../../sharedInterfaces/queryResult";
import { FilterableColumn } from "./interfaces";

export const SLICKGRID_ROW_ID_PROP = "_mssqlRowId";

function hasSortOrFilterApplied(grid: Slick.Grid<any>): boolean {
    const sortedColumns = grid.getSortColumns();

    const columns = grid.getColumns() as FilterableColumn<any>[];

    return columns.some((column) => {
        if (!column) {
            return false;
        }

        const isFiltered = column?.filterValues?.length ?? 0 > 0;
        const isSorted = sortedColumns?.some(
            (sort) => sort.columnId === column.id && sort.sortAsc !== undefined,
        );

        return isFiltered || isSorted;
    });
}

function getActualRowIndex(grid: Slick.Grid<any>, displayRow: number): number | undefined {
    const item = grid.getDataItem(displayRow) as Record<string, unknown>;
    if (!item) {
        return undefined;
    }
    return item[SLICKGRID_ROW_ID_PROP] as number;
}

export function convertDisplayedSelectionToActual(
    grid: Slick.Grid<any>,
    selections: ISlickRange[],
): ISlickRange[] {
    if (selections.length === 0) {
        return selections;
    }
    const actualSelections: ISlickRange[] = [];
    const shouldMapRows = hasSortOrFilterApplied(grid);

    if (!shouldMapRows) {
        return selections;
    }

    for (const selection of selections) {
        const actualRows = new Set<number>();

        for (let displayRow = selection.fromRow; displayRow <= selection.toRow; displayRow++) {
            const actualRow = getActualRowIndex(grid, displayRow);
            actualRows.add(actualRow ?? displayRow);
        }

        const orderedRows = Array.from(actualRows.values()).sort((a, b) => a - b);
        if (orderedRows.length === 0) {
            continue;
        }

        let rangeStart = orderedRows[0];
        let previous = orderedRows[0];

        for (let i = 1; i < orderedRows.length; i++) {
            const current = orderedRows[i];
            if (current <= previous + 1) {
                previous = current;
                continue;
            }

            actualSelections.push({
                fromCell: selection.fromCell,
                toCell: selection.toCell,
                fromRow: rangeStart,
                toRow: previous,
            });

            rangeStart = current;
            previous = current;
        }

        actualSelections.push({
            fromCell: selection.fromCell,
            toCell: selection.toCell,
            fromRow: rangeStart,
            toRow: previous,
        });
    }

    return actualSelections;
}

export interface RowRange {
    start: number;
    length: number;
}

export function tryCombineSelectionsForResults(selections: ISlickRange[]): ISlickRange[] {
    // need to take row number column in to consideration.
    return tryCombineSelections(selections).map((range) => {
        return {
            fromCell: range.fromCell - 1,
            fromRow: range.fromRow,
            toCell: range.toCell - 1,
            toRow: range.toRow,
        };
    });
}

export function selectionToRange(selection: ISlickRange): RowRange {
    let range: RowRange = {
        start: selection.fromRow,
        length: selection.toRow - selection.fromRow + 1,
    };
    return range;
}

export function tryCombineSelections(selections: ISlickRange[]): ISlickRange[] {
    if (!selections || selections.length === 0 || selections.length === 1) {
        return selections;
    }

    // If the selections combine into a single continuous selection, this will be the selection
    let unifiedSelection: ISlickRange = {
        fromCell: selections
            .map((range) => range.fromCell)
            .reduce((min, next) => (next < min ? next : min)),
        fromRow: selections
            .map((range) => range.fromRow)
            .reduce((min, next) => (next < min ? next : min)),
        toCell: selections
            .map((range) => range.toCell)
            .reduce((max, next) => (next > max ? next : max)),
        toRow: selections
            .map((range) => range.toRow)
            .reduce((max, next) => (next > max ? next : max)),
    };

    // Verify whether all cells in the combined selection have actually been selected
    let verifiers: ((cell: [number, number]) => boolean)[] = [];
    selections.forEach((range) => {
        verifiers.push((cell: [number, number]) => {
            return (
                cell[0] >= range.fromRow &&
                cell[0] <= range.toRow &&
                cell[1] >= range.fromCell &&
                cell[1] <= range.toCell
            );
        });
    });
    for (let row = unifiedSelection.fromRow; row <= unifiedSelection.toRow; row++) {
        for (let column = unifiedSelection.fromCell; column <= unifiedSelection.toCell; column++) {
            // If some cell in the combined selection isn't actually selected, return the original selections
            if (!verifiers.some((verifier) => verifier([row, column]))) {
                return selections;
            }
        }
    }
    return [unifiedSelection];
}

export function selectEntireGrid<T extends Slick.SlickData>(grid: Slick.Grid<T>): ISlickRange[] {
    const data = grid.getData() as T[];
    const totalRows = data.length;
    const totalColumns = grid.getColumns().length;

    // Create a selection for the entire grid
    return [
        {
            fromRow: 0,
            toRow: totalRows - 1,
            fromCell: 0,
            toCell: totalColumns - 2, // Subtract 2 to account for row number column and 0-based indexing
        },
    ];
}
