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
    ranges: SlickRange[];
}

export interface FluentResultGridColumnVisibility {
    hidden?: boolean;
}

export interface FluentResultGridColumnCoordinate extends FluentResultGridColumnVisibility {
    field?: string | number;
}

export function getFluentResultGridDataColumnIndex(
    column: FluentResultGridColumnCoordinate | undefined,
): number | undefined {
    const columnIndex = Number(column?.field);
    return Number.isInteger(columnIndex) ? columnIndex : undefined;
}

export function getVisibleFluentResultGridDataCellIndexes(
    columns: readonly FluentResultGridColumnCoordinate[],
): number[] {
    return columns.flatMap((column, cell) =>
        !column.hidden && getFluentResultGridDataColumnIndex(column) !== undefined ? [cell] : [],
    );
}

export function getFluentResultGridRowEdgeCell(
    columns: readonly FluentResultGridColumnCoordinate[],
    toEnd: boolean,
): number | undefined {
    const visibleCells = getVisibleFluentResultGridDataCellIndexes(columns);
    return toEnd ? visibleCells.at(-1) : visibleCells[0];
}

/**
 * Builds one range per contiguous run of visible columns. Hidden columns cannot be range
 * endpoints because SlickGrid's selection model rejects them in `canCellBeSelected`; splitting at
 * every hidden column also keeps row-wide commands from including hidden cell values.
 */
export function getFluentResultGridRangesForVisibleColumns(
    columns: readonly FluentResultGridColumnVisibility[],
    fromRow: number,
    toRow: number,
    firstDataCell = FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
): SlickRange[] {
    const ranges: SlickRange[] = [];
    let rangeStart: number | undefined;

    for (let cell = firstDataCell; cell <= columns.length; cell++) {
        const isVisible = cell < columns.length && !!columns[cell] && !columns[cell].hidden;
        if (isVisible && rangeStart === undefined) {
            rangeStart = cell;
        } else if (!isVisible && rangeStart !== undefined) {
            ranges.push(new SlickRange(fromRow, rangeStart, toRow, cell - 1));
            rangeStart = undefined;
        }
    }

    return ranges;
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

/** Double-clicking a cell selects every visible data cell in that row. */
export function handleFluentResultGridRowDoubleClick(
    event: CustomEvent,
    showRowNumberColumn: boolean,
): void {
    const args = event.detail?.args;
    const grid = args?.grid as SlickGrid | undefined;
    if (!grid || args?.row === undefined) {
        return;
    }

    const firstDataCell = showRowNumberColumn ? FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX : 0;
    const ranges = getFluentResultGridRangesForVisibleColumns(
        grid.getColumns(),
        args.row,
        args.row,
        firstDataCell,
    );
    if (ranges.length === 0) {
        return;
    }

    setFluentResultGridSelection(grid, ranges, {
        row: args.row,
        cell: ranges[0].fromCell,
    });
}

export function clearFluentResultGridSelection(
    grid: Pick<SlickGrid, "getSelectionModel" | "resetActiveCell">,
): void {
    grid.getSelectionModel()?.setSelectedRanges([]);
    grid.resetActiveCell();
}

/**
 * Row-number clicks select whole rows. Ctrl/Cmd toggles the clicked row in or out of the current
 * selection, Shift extends from the active row, and a plain click replaces the selection.
 *
 * This is resolved inside FluentResultGridSelectionModel rather than in the React onClick callback:
 * the callback is published after SlickGrid's direct event subscribers, so by the time it runs the
 * selection model has already folded the clicked row-number cell into the ranges.
 */
export function getFluentResultGridRowNumberClickSelection(
    selectedRanges: readonly SlickRange[],
    clickedCell: FluentResultGridSelectionCell,
    activeCell: FluentResultGridSelectionCell | null,
    modifiers: FluentResultGridSelectionClickModifiers,
    columnCount: number,
    showRowNumberColumn: boolean,
    columns: readonly FluentResultGridColumnVisibility[] = Array.from(
        { length: columnCount },
        () => ({}),
    ),
): FluentResultGridClickSelection | undefined {
    if (!showRowNumberColumn || clickedCell.cell !== 0) {
        return undefined;
    }

    const visibleRowRanges = getFluentResultGridRangesForVisibleColumns(
        columns,
        clickedCell.row,
        clickedCell.row,
    );
    if (visibleRowRanges.length === 0) {
        return undefined;
    }

    return {
        activeCell: {
            row: clickedCell.row,
            cell: visibleRowRanges[0].fromCell,
        },
        ranges: getFluentResultGridRangesAfterRowNumberClick(
            selectedRanges,
            clickedCell.row,
            activeCell,
            modifiers,
            visibleRowRanges,
        ),
    };
}

function getFluentResultGridRangesAfterRowNumberClick(
    selectedRanges: readonly SlickRange[],
    clickedRow: number,
    activeCell: FluentResultGridSelectionCell | null,
    modifiers: FluentResultGridSelectionClickModifiers,
    visibleRowRanges: readonly SlickRange[],
): SlickRange[] {
    // Production gives Shift precedence when multiple modifiers are held.
    if (modifiers.shiftKey) {
        return visibleRowRanges.map(
            (range) =>
                new SlickRange(
                    activeCell?.row ?? clickedRow,
                    range.fromCell,
                    clickedRow,
                    range.toCell,
                ),
        );
    }

    if (modifiers.ctrlKey || modifiers.metaKey) {
        return toggleFluentResultGridSelectedRow(selectedRanges, clickedRow, visibleRowRanges);
    }

    return [...visibleRowRanges];
}

/**
 * Ctrl/Cmd removes a row only when every visible cell in it is already selected. A partially
 * selected row is replaced with a full visible-row selection while selections on other rows are
 * preserved.
 */
export function toggleFluentResultGridSelectedRow(
    selectedRanges: readonly SlickRange[],
    row: number,
    visibleRowRanges: readonly SlickRange[],
): SlickRange[] {
    const isRowFullySelected = visibleRowRanges.every((visibleRange) =>
        Array.from(
            { length: visibleRange.toCell - visibleRange.fromCell + 1 },
            (_, offset) => visibleRange.fromCell + offset,
        ).every((cell) =>
            selectedRanges.some(
                (range) =>
                    range.fromRow <= row &&
                    range.toRow >= row &&
                    range.fromCell <= cell &&
                    range.toCell >= cell,
            ),
        ),
    );
    const rangesWithoutRow = removeFluentResultGridRowFromRanges(selectedRanges, row);

    if (!isRowFullySelected) {
        return visibleRowRanges.reduce<SlickRange[]>(
            (ranges, range) => insertFluentResultGridSelectionRange(ranges, range),
            rangesWithoutRow,
        );
    }

    return rangesWithoutRow;
}

function removeFluentResultGridRowFromRanges(
    selectedRanges: readonly SlickRange[],
    row: number,
): SlickRange[] {
    const nextRanges: SlickRange[] = [];
    for (const range of selectedRanges) {
        if (range.fromRow > row || range.toRow < row) {
            nextRanges.push(range);
            continue;
        }

        if (range.fromRow < row) {
            nextRanges.push(new SlickRange(range.fromRow, range.fromCell, row - 1, range.toCell));
        }
        if (range.toRow > row) {
            nextRanges.push(new SlickRange(row + 1, range.fromCell, range.toRow, range.toCell));
        }
    }

    return nextRanges;
}

/**
 * Column-header clicks select whole columns, with the same modifier semantics as row numbers:
 * Ctrl/Cmd toggles the column, Shift extends from the active cell's column.
 */
export function getFluentResultGridRangesAfterHeaderClick(
    selectedRanges: readonly SlickRange[],
    clickedColumnIndex: number,
    activeCell: FluentResultGridSelectionCell | null,
    modifiers: FluentResultGridSelectionClickModifiers,
    rowCount: number,
    firstDataCell = FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
): SlickRange[] {
    const lastRow = rowCount - 1;

    // Production gives Shift precedence when multiple modifiers are held.
    if (modifiers.shiftKey) {
        const anchorColumn = Math.max(activeCell?.cell ?? clickedColumnIndex, firstDataCell);
        return [new SlickRange(0, anchorColumn, lastRow, clickedColumnIndex)];
    }

    if (modifiers.ctrlKey || modifiers.metaKey) {
        return toggleFluentResultGridSelectedColumn(selectedRanges, clickedColumnIndex, lastRow);
    }

    return [new SlickRange(0, clickedColumnIndex, lastRow, clickedColumnIndex)];
}

export function getFluentResultGridKeyboardExpansion({
    selectedRanges,
    activeCell,
    keyCode,
    rowCount,
    columns,
}: {
    selectedRanges: readonly SlickRange[];
    activeCell: FluentResultGridSelectionCell;
    keyCode: string;
    rowCount: number;
    columns: readonly FluentResultGridColumnCoordinate[];
}): { ranges: SlickRange[]; target: FluentResultGridSelectionCell } | undefined {
    if (rowCount <= 0) {
        return undefined;
    }

    const nextRanges = [...selectedRanges];
    let lastRange = nextRanges.pop() ?? new SlickRange(activeCell.row, activeCell.cell);
    if (!lastRange.contains(activeCell.row, activeCell.cell)) {
        lastRange = new SlickRange(activeCell.row, activeCell.cell);
    }

    let targetRow = activeCell.row === lastRange.fromRow ? lastRange.toRow : lastRange.fromRow;
    let targetCell = activeCell.cell === lastRange.fromCell ? lastRange.toCell : lastRange.fromCell;

    if (keyCode === "ArrowUp" || keyCode === "ArrowDown") {
        targetRow = Math.min(
            Math.max(targetRow + (keyCode === "ArrowUp" ? -1 : 1), 0),
            rowCount - 1,
        );
    } else if (keyCode === "ArrowLeft" || keyCode === "ArrowRight") {
        const visibleCells = getVisibleFluentResultGridDataCellIndexes(columns);
        if (visibleCells.length === 0) {
            return undefined;
        }

        const direction = keyCode === "ArrowLeft" ? -1 : 1;
        let visibleCellPosition = visibleCells.indexOf(targetCell);
        if (visibleCellPosition < 0) {
            visibleCellPosition =
                direction < 0
                    ? visibleCells.findLastIndex((cell) => cell < targetCell)
                    : visibleCells.findIndex((cell) => cell > targetCell);
        } else {
            visibleCellPosition += direction;
        }
        visibleCellPosition = Math.min(Math.max(visibleCellPosition, 0), visibleCells.length - 1);
        targetCell = visibleCells[visibleCellPosition];
    } else {
        return undefined;
    }

    nextRanges.push(new SlickRange(activeCell.row, activeCell.cell, targetRow, targetCell));
    return {
        ranges: nextRanges,
        target: { row: targetRow, cell: targetCell },
    };
}

/**
 * Only a range covering the column's full height counts as "the column is selected". A partial
 * range that happens to overlap the column is left alone so Ctrl/Cmd adds the full column instead
 * of carving a hole out of an unrelated block selection.
 */
export function toggleFluentResultGridSelectedColumn(
    selectedRanges: readonly SlickRange[],
    columnIndex: number,
    lastRow: number,
): SlickRange[] {
    const coversColumn = (range: SlickRange) =>
        range.fromCell <= columnIndex &&
        range.toCell >= columnIndex &&
        range.fromRow === 0 &&
        range.toRow === lastRow;

    if (!selectedRanges.some(coversColumn)) {
        return insertFluentResultGridSelectionRange(
            selectedRanges,
            new SlickRange(0, columnIndex, lastRow, columnIndex),
        );
    }

    const nextRanges: SlickRange[] = [];
    for (const range of selectedRanges) {
        if (!coversColumn(range)) {
            nextRanges.push(range);
            continue;
        }

        if (range.fromCell < columnIndex) {
            nextRanges.push(
                new SlickRange(range.fromRow, range.fromCell, range.toRow, columnIndex - 1),
            );
        }
        if (range.toCell > columnIndex) {
            nextRanges.push(
                new SlickRange(range.fromRow, columnIndex + 1, range.toRow, range.toCell),
            );
        }
    }

    return nextRanges;
}

export function getFluentResultGridRangesAfterClick(
    selectedRanges: readonly SlickRange[],
    clickedCell: FluentResultGridSelectionCell,
    activeCell: FluentResultGridSelectionCell | null,
    modifiers: FluentResultGridSelectionClickModifiers,
): SlickRange[] {
    // Production gives Shift precedence when multiple modifiers are held.
    if (modifiers.shiftKey) {
        return [
            activeCell
                ? new SlickRange(activeCell.row, activeCell.cell, clickedCell.row, clickedCell.cell)
                : new SlickRange(clickedCell.row, clickedCell.cell),
        ];
    }

    if (modifiers.ctrlKey || modifiers.metaKey) {
        return toggleFluentResultGridSelectedCell(
            selectedRanges,
            clickedCell.row,
            clickedCell.cell,
        );
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

export function getFluentResultGridDataSelectionsFromRanges(
    selectedRanges: readonly SlickRange[],
    columns: readonly FluentResultGridColumnCoordinate[],
): ISlickRange[] {
    const selections: ISlickRange[] = [];

    for (const selectedRange of selectedRanges) {
        const range = toFluentResultGridSelectionRange(selectedRange);
        let sourceRunStart: number | undefined;
        let previousSourceColumn: number | undefined;

        const flushRun = () => {
            if (sourceRunStart === undefined || previousSourceColumn === undefined) {
                return;
            }

            selections.push({
                fromCell: sourceRunStart,
                fromRow: range.fromRow,
                toCell: previousSourceColumn,
                toRow: range.toRow,
            });
            sourceRunStart = undefined;
            previousSourceColumn = undefined;
        };

        for (let cell = range.fromCell; cell <= range.toCell; cell++) {
            const column = columns[cell];
            const sourceColumn =
                column && !column.hidden ? getFluentResultGridDataColumnIndex(column) : undefined;
            if (sourceColumn === undefined) {
                flushRun();
                continue;
            }

            if (sourceRunStart === undefined || previousSourceColumn === undefined) {
                sourceRunStart = sourceColumn;
                previousSourceColumn = sourceColumn;
            } else if (sourceColumn === previousSourceColumn + 1) {
                previousSourceColumn = sourceColumn;
            } else {
                flushRun();
                sourceRunStart = sourceColumn;
                previousSourceColumn = sourceColumn;
            }
        }

        flushRun();
    }

    return selections;
}

/**
 * Count distinct selected rows from inclusive ranges without expanding a
 * potentially million-row selection. Adjacent and overlapping intervals are
 * merged in O(R log R) time and O(R) memory, where R is the range count.
 */
export function countFluentResultGridSelectedRows(selections: readonly ISlickRange[]): number {
    const intervals = selections
        .filter((selection) => selection.toRow >= selection.fromRow)
        .map((selection) => ({ from: selection.fromRow, to: selection.toRow }))
        .sort((left, right) => left.from - right.from || left.to - right.to);
    if (intervals.length === 0) {
        return 0;
    }

    let count = 0;
    let currentFrom = intervals[0].from;
    let currentTo = intervals[0].to;
    for (let index = 1; index < intervals.length; index++) {
        const interval = intervals[index];
        if (interval.from <= currentTo + 1) {
            currentTo = Math.max(currentTo, interval.to);
            continue;
        }
        count += currentTo - currentFrom + 1;
        currentFrom = interval.from;
        currentTo = interval.to;
    }
    return count + currentTo - currentFrom + 1;
}

export function isFluentResultGridAllCellsSelected(
    selectedRanges: readonly SlickRange[],
    rowCount: number,
    columnCount: number,
): boolean {
    const range = selectedRanges.length === 1 ? selectedRanges[0] : undefined;
    return (
        rowCount > 0 &&
        columnCount > FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX &&
        range?.fromRow === 0 &&
        range.toRow === rowCount - 1 &&
        range.fromCell === FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX &&
        range.toCell === columnCount - 1
    );
}

export function getFluentResultGridSlickRangesFromDataSelections(
    selections: readonly ISlickRange[] | undefined,
    rowCount: number,
    columns: readonly FluentResultGridColumnCoordinate[],
): SlickRange[] {
    if (!selections?.length || rowCount <= 0 || columns.length === 0) {
        return [];
    }

    const lastRow = rowCount - 1;
    const ranges: SlickRange[] = [];

    for (const selection of selections) {
        const fromRow = Math.min(
            Math.max(Math.min(selection.fromRow, selection.toRow), 0),
            lastRow,
        );
        const toRow = Math.min(Math.max(Math.max(selection.fromRow, selection.toRow), 0), lastRow);
        const fromSourceColumn = Math.min(selection.fromCell, selection.toCell);
        const toSourceColumn = Math.max(selection.fromCell, selection.toCell);
        if (toRow < fromRow) {
            continue;
        }

        let visualRunStart: number | undefined;
        for (let cell = 0; cell <= columns.length; cell++) {
            const column = columns[cell];
            const sourceColumn =
                column && !column.hidden ? getFluentResultGridDataColumnIndex(column) : undefined;
            const isSelected =
                sourceColumn !== undefined &&
                sourceColumn >= fromSourceColumn &&
                sourceColumn <= toSourceColumn;
            if (isSelected && visualRunStart === undefined) {
                visualRunStart = cell;
            } else if (!isSelected && visualRunStart !== undefined) {
                ranges.push(new SlickRange(fromRow, visualRunStart, toRow, cell - 1));
                visualRunStart = undefined;
            }
        }
    }

    return ranges.reduce<SlickRange[]>(
        (mergedRanges, range) => insertFluentResultGridSelectionRange(mergedRanges, range),
        [],
    );
}

export function getFirstVisibleCellInFluentResultGridRange(
    grid: SlickGrid,
    range: SlickRange,
): { row: number; cell: number } | undefined {
    const columns = grid.getColumns();
    for (let cell = range.fromCell; cell <= range.toCell; cell++) {
        const column = columns[cell];
        if (column && !column.hidden && getFluentResultGridDataColumnIndex(column) !== undefined) {
            return { row: range.fromRow, cell };
        }
    }

    const fallbackCell = columns.findIndex(
        (column) => !column.hidden && getFluentResultGridDataColumnIndex(column) !== undefined,
    );
    return fallbackCell >= 0 ? { row: range.fromRow, cell: fallbackCell } : undefined;
}

export function getDisplayedFluentResultGridSelectionForCopy(
    grid: SlickGrid,
    rowCount: number,
): ISlickRange[] {
    if (rowCount <= 0) {
        return [];
    }

    const columns = grid.getColumns();
    const selectedRanges = grid.getSelectionModel()?.getSelectedRanges() ?? [];
    const dataSelections = getFluentResultGridDataSelectionsFromRanges(selectedRanges, columns);

    if (dataSelections.length > 0) {
        return orderFluentResultGridSelectionsByDisplayPosition(dataSelections);
    }

    const visibleCells = getVisibleFluentResultGridDataCellIndexes(columns);
    return getFluentResultGridDataSelectionsFromRanges(
        getFluentResultGridRangesForVisibleColumns(
            columns,
            0,
            rowCount - 1,
            visibleCells[0] ?? columns.length,
        ),
        columns,
    );
}

export function getFluentResultGridSelectionSummaryPayload(
    ranges: readonly SlickRange[],
    columns: readonly FluentResultGridColumnCoordinate[],
    getActualRowId?: (displayRow: number) => number | undefined,
): { selection: ISlickRange[]; displaySelection: ISlickRange[] } {
    const displaySelection = getFluentResultGridDataSelectionsFromRanges(ranges, columns);
    return {
        displaySelection,
        selection: getActualRowId
            ? convertDisplayedSelectionRowsToActual(displaySelection, getActualRowId)
            : displaySelection,
    };
}

/**
 * Save As consumes source-row indexes. Unlike copy, no explicit selection stays empty because an
 * empty selection tells the service to save the complete result set.
 */
export function getFluentResultGridSelectionForSave(
    grid: SlickGrid,
    getActualRowId?: (displayRow: number) => number | undefined,
): ISlickRange[] {
    const selectedRanges = grid.getSelectionModel()?.getSelectedRanges() ?? [];
    if (selectedRanges.length === 0) {
        return [];
    }

    const displayedSelection = getDisplayedFluentResultGridSelectionForCopy(
        grid,
        grid.getDataLength(),
    );
    return getActualRowId
        ? convertDisplayedSelectionRowsToActual(displayedSelection, getActualRowId)
        : displayedSelection;
}

export function convertDisplayedSelectionRowsToActual(
    selection: readonly ISlickRange[],
    getActualRowId: (displayRow: number) => number | undefined,
): ISlickRange[] {
    const converted: ISlickRange[] = [];
    const orderedSelection = orderFluentResultGridSelectionsByDisplayPosition(selection);

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

function orderFluentResultGridSelectionsByDisplayPosition(
    selection: readonly ISlickRange[],
): ISlickRange[] {
    return [...selection].sort((left, right) => {
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
}
