/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SlickRange } from "@slickgrid-universal/common";
import type { SlickGrid } from "slickgrid-react";
import type { ISlickRange } from "../../../../sharedInterfaces/queryResult";
import { FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX } from "./fluentResultGridConstants";

export interface FluentResultGridSelectionCell {
    row: number;
    cell: number;
}

export interface FluentResultGridSelectionClickModifiers {
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
}

export interface FluentResultGridClickSelection {
    activeCell: FluentResultGridSelectionCell;
    range: SlickRange;
}

/**
 * Restoring the active cell is focus state, not a new selection gesture. Suppress
 * onActiveCellChanged so restoring focus cannot collapse an already-restored multi-selection.
 */
export function activateFluentResultGridCellWithoutChangingSelection(
    grid: Pick<SlickGrid, "setActiveCell">,
    cell: FluentResultGridSelectionCell,
): void {
    grid.setActiveCell(cell.row, cell.cell, false, false, true);
}

/**
 * Updates focus and selection as one transaction. The active-cell notification must be suppressed
 * or the selection model will interpret the focus update as a new single-cell selection.
 */
export function setFluentResultGridSelection(
    grid: Pick<SlickGrid, "getSelectionModel" | "setActiveCell">,
    ranges: SlickRange[],
    activeCell?: FluentResultGridSelectionCell,
): void {
    if (activeCell) {
        activateFluentResultGridCellWithoutChangingSelection(grid, activeCell);
    }
    grid.getSelectionModel()?.setSelectedRanges(ranges);
}

export function clearFluentResultGridSelection(
    grid: Pick<SlickGrid, "getSelectionModel" | "resetActiveCell">,
): void {
    grid.getSelectionModel()?.setSelectedRanges([]);
    grid.resetActiveCell();
}

/**
 * Data-cell clicks are owned by FluentResultGridSelectionModel. The React onClick callback is
 * published after SlickGrid's direct event subscribers, so changing a data-cell selection there
 * would overwrite Ctrl/Cmd-click ranges already computed by the selection model.
 */
export function getFluentResultGridClickSelection(
    clickedCell: FluentResultGridSelectionCell,
    columnCount: number,
    showRowNumberColumn: boolean,
): FluentResultGridClickSelection | undefined {
    if (!showRowNumberColumn || clickedCell.cell !== 0) {
        return undefined;
    }

    return {
        activeCell: {
            row: clickedCell.row,
            cell: FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
        },
        range: new SlickRange(
            clickedCell.row,
            FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
            clickedCell.row,
            columnCount - 1,
        ),
    };
}

export function getFluentResultGridRangesAfterClick(
    selectedRanges: readonly SlickRange[],
    clickedCell: FluentResultGridSelectionCell,
    activeCell: FluentResultGridSelectionCell | null,
    modifiers: FluentResultGridSelectionClickModifiers,
): SlickRange[] {
    if (modifiers.ctrlKey || modifiers.metaKey) {
        return toggleFluentResultGridSelectedCell(
            selectedRanges,
            clickedCell.row,
            clickedCell.cell,
        );
    }

    if (modifiers.shiftKey && activeCell) {
        return [new SlickRange(activeCell.row, activeCell.cell, clickedCell.row, clickedCell.cell)];
    }

    return [new SlickRange(clickedCell.row, clickedCell.cell)];
}

export function getFluentResultGridRangesAfterDrag(
    selectedRanges: readonly SlickRange[],
    draggedRange: SlickRange,
    append: boolean,
): SlickRange[] {
    if (!append) {
        return [draggedRange];
    }

    return insertFluentResultGridSelectionRange(selectedRanges, draggedRange);
}

function tryMergeFluentResultGridSelectionRanges(
    first: SlickRange,
    second: SlickRange,
): SlickRange | undefined {
    const sameRows = first.fromRow === second.fromRow && first.toRow === second.toRow;
    const cellsTouchOrOverlap =
        first.fromCell <= second.toCell + 1 && second.fromCell <= first.toCell + 1;
    if (sameRows && cellsTouchOrOverlap) {
        return new SlickRange(
            first.fromRow,
            Math.min(first.fromCell, second.fromCell),
            first.toRow,
            Math.max(first.toCell, second.toCell),
        );
    }

    const sameCells = first.fromCell === second.fromCell && first.toCell === second.toCell;
    const rowsTouchOrOverlap =
        first.fromRow <= second.toRow + 1 && second.fromRow <= first.toRow + 1;
    if (sameCells && rowsTouchOrOverlap) {
        return new SlickRange(
            Math.min(first.fromRow, second.fromRow),
            first.fromCell,
            Math.max(first.toRow, second.toRow),
            first.toCell,
        );
    }

    return undefined;
}

export function insertFluentResultGridSelectionRange(
    selectedRanges: readonly SlickRange[],
    rangeToInsert: SlickRange,
): SlickRange[] {
    const remainingRanges = [...selectedRanges];
    let mergedRange = rangeToInsert;

    for (let index = remainingRanges.length - 1; index >= 0; index--) {
        const combinedRange = tryMergeFluentResultGridSelectionRanges(
            remainingRanges[index],
            mergedRange,
        );
        if (combinedRange) {
            mergedRange = combinedRange;
            remainingRanges.splice(index, 1);
            // A merge can make the result adjacent to a range already examined.
            index = remainingRanges.length;
        }
    }

    return [...remainingRanges, mergedRange];
}

export function toggleFluentResultGridSelectedCell(
    selectedRanges: readonly SlickRange[],
    row: number,
    cell: number,
): SlickRange[] {
    const nextRanges: SlickRange[] = [];
    let removedSelectedCell = false;

    for (const range of selectedRanges) {
        if (!range.contains(row, cell)) {
            nextRanges.push(range);
            continue;
        }

        removedSelectedCell = true;
        if (range.fromRow < row) {
            nextRanges.push(new SlickRange(range.fromRow, range.fromCell, row - 1, range.toCell));
        }
        if (row < range.toRow) {
            nextRanges.push(new SlickRange(row + 1, range.fromCell, range.toRow, range.toCell));
        }
        if (range.fromCell < cell) {
            nextRanges.push(new SlickRange(row, range.fromCell, row, cell - 1));
        }
        if (cell < range.toCell) {
            nextRanges.push(new SlickRange(row, cell + 1, row, range.toCell));
        }
    }

    return removedSelectedCell
        ? nextRanges
        : insertFluentResultGridSelectionRange(selectedRanges, new SlickRange(row, cell));
}

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
