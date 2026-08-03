/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SlickRange } from "@slickgrid-universal/common";
import type { SlickGrid } from "slickgrid-react";
import type { ISlickRange } from "../../../../sharedInterfaces/queryResult";
import { FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX } from "./fluentResultGridConstants";

export function toFluentResultGridSelectionRange(range: SlickRange): ISlickRange {
    return {
        fromCell: Math.min(range.fromCell, range.toCell),
        fromRow: Math.min(range.fromRow, range.toRow),
        toCell: Math.max(range.fromCell, range.toCell),
        toRow: Math.max(range.fromRow, range.toRow),
    };
}

export function toFluentResultGridActualDataSelection(range: ISlickRange): ISlickRange | undefined {
    const fromCell =
        Math.max(FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX, range.fromCell) -
        FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX;
    const toCell =
        Math.max(FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX, range.toCell) -
        FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX;

    if (toCell < fromCell || range.toRow < range.fromRow) {
        return undefined;
    }

    return {
        fromCell,
        fromRow: range.fromRow,
        toCell,
        toRow: range.toRow,
    };
}

export function getFluentResultGridDataSelectionsFromRanges(
    selectedRanges: SlickRange[],
): ISlickRange[] {
    return selectedRanges
        .map(toFluentResultGridSelectionRange)
        .map(toFluentResultGridActualDataSelection)
        .filter((selection): selection is ISlickRange => selection !== undefined);
}

export function getFluentResultGridSlickRangesFromDataSelections(
    selections: readonly ISlickRange[] | undefined,
    rowCount: number,
    columnCount: number,
): SlickRange[] {
    if (
        !selections?.length ||
        rowCount <= 0 ||
        columnCount <= FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX
    ) {
        return [];
    }

    const lastRow = rowCount - 1;
    const lastCell = columnCount - 1;

    return selections
        .map((selection) => {
            const fromRow = Math.min(Math.max(selection.fromRow, 0), lastRow);
            const toRow = Math.min(Math.max(selection.toRow, 0), lastRow);
            const fromCell = Math.min(
                Math.max(
                    selection.fromCell + FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
                    FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
                ),
                lastCell,
            );
            const toCell = Math.min(
                Math.max(
                    selection.toCell + FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
                    FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
                ),
                lastCell,
            );

            if (toRow < fromRow || toCell < fromCell) {
                return undefined;
            }

            return new SlickRange(fromRow, fromCell, toRow, toCell);
        })
        .filter((range): range is SlickRange => range !== undefined);
}

export function getFirstVisibleCellInFluentResultGridRange(
    grid: SlickGrid,
    range: SlickRange,
): { row: number; cell: number } | undefined {
    const columns = grid.getColumns();
    for (let cell = range.fromCell; cell <= range.toCell; cell++) {
        const column = columns[cell];
        if (column && !column.hidden && cell >= FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX) {
            return { row: range.fromRow, cell };
        }
    }

    const fallbackCell = columns.findIndex(
        (column, index) => index >= FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX && !column.hidden,
    );
    return fallbackCell >= FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX
        ? { row: range.fromRow, cell: fallbackCell }
        : undefined;
}

export function getDisplayedFluentResultGridSelectionForCopy(
    grid: SlickGrid,
    rowCount: number,
): ISlickRange[] {
    const selectedRanges = grid.getSelectionModel()?.getSelectedRanges() ?? [];
    const dataSelections = getFluentResultGridDataSelectionsFromRanges(selectedRanges);

    if (dataSelections.length > 0) {
        return dataSelections;
    }

    return [
        {
            fromCell: 0,
            fromRow: 0,
            toCell: grid.getColumns().length - 2,
            toRow: Math.max(0, rowCount - 1),
        },
    ];
}

export function convertDisplayedSelectionRowsToActual(
    selection: readonly ISlickRange[],
    getActualRowId: (displayRow: number) => number | undefined,
): ISlickRange[] {
    const converted: ISlickRange[] = [];
    const orderedSelection = [...selection].sort((left, right) => {
        if (left.fromRow !== right.fromRow) {
            return left.fromRow - right.fromRow;
        }
        if (left.fromCell !== right.fromCell) {
            return left.fromCell - right.fromCell;
        }
        if (left.toRow !== right.toRow) {
            return left.toRow - right.toRow;
        }

        return left.toCell - right.toCell;
    });

    for (const range of orderedSelection) {
        let start: number | undefined;
        let previous: number | undefined;

        const flushRange = () => {
            if (start === undefined || previous === undefined) {
                return;
            }

            converted.push({
                fromCell: range.fromCell,
                fromRow: start,
                toCell: range.toCell,
                toRow: previous,
            });

            start = undefined;
            previous = undefined;
        };

        for (let row = range.fromRow; row <= range.toRow; row++) {
            const actualRow = getActualRowId(row);
            if (actualRow === undefined) {
                flushRange();
                continue;
            }

            if (start === undefined || previous === undefined) {
                start = actualRow;
                previous = actualRow;
                continue;
            }

            if (actualRow === previous + 1) {
                previous = actualRow;
                continue;
            }

            flushRange();
            start = actualRow;
            previous = actualRow;
        }

        flushRange();
    }

    return converted;
}
