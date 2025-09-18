/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Drag select selection model gist taken from https://gist.github.com/skoon/5312536
// heavily modified

import { CellRangeSelector, ICellRangeSelector } from "./cellRangeSelector";
import {
    SelectionSummaryStats,
    SetSelectionSummaryRequest,
} from "../../../../../sharedInterfaces/queryResult";

import { isUndefinedOrNull } from "../tableDataView";
import { mixin } from "../objects";
import { tokens } from "@fluentui/react-components";
import { Keys } from "../../../../common/keys";
import { QueryResultReactProvider } from "../../queryResultStateProvider";

export interface ICellSelectionModelOptions {
    cellRangeSelector?: any;
    /**
     * Whether the grid has a row selection column. Needs to take this into account to decide the cell click's selection range.
     */
    hasRowSelector?: boolean;
}

const defaults: ICellSelectionModelOptions = {
    hasRowSelector: false,
};

interface EventTargetWithClassName extends EventTarget {
    className: string | undefined;
}

export class CellSelectionModel<T extends Slick.SlickData>
    implements Slick.SelectionModel<T, Array<Slick.Range>>
{
    private grid!: Slick.Grid<T>;
    private selector: ICellRangeSelector<T>;
    private ranges: Array<Slick.Range> = [];
    private _handler = new Slick.EventHandler();
    private isMac: boolean | undefined;

    public onSelectedRangesChanged = new Slick.Event<Array<Slick.Range>>();

    constructor(
        private options: ICellSelectionModelOptions = defaults,
        private context: QueryResultReactProvider,
    ) {
        this.options = mixin(this.options, defaults, false);
        if (this.options.cellRangeSelector) {
            this.selector = this.options.cellRangeSelector;
        } else {
            // this is added by the node requires above
            this.selector = new CellRangeSelector({
                selectionCss: {
                    border: `3px dashed ${tokens.colorStrokeFocus1}`,
                },
            });
        }
    }

    public init(grid: Slick.Grid<T>) {
        this.grid = grid;
        this.isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        this._handler.subscribe(this.grid.onKeyDown, (e: Slick.DOMEvent) =>
            this.handleKeyDown(e as unknown as KeyboardEvent),
        );
        this._handler.subscribe(this.grid.onAfterKeyboardNavigation, (_e: Event) =>
            this.handleAfterKeyboardNavigationEvent(),
        );
        this._handler.subscribe(
            this.grid.onClick,
            async (e: Slick.DOMEvent, args: Slick.OnClickEventArgs<T>) =>
                await this.handleCellClick(e as MouseEvent, args),
        );
        this._handler.subscribe(
            this.grid.onHeaderClick,
            (e: Slick.DOMEvent, args: Slick.OnHeaderClickEventArgs<T>) =>
                this.handleHeaderClick(e as MouseEvent, args),
        );
        this._handler.subscribe(
            this.grid.onDblClick,
            (e: Slick.DOMEvent, args: Slick.OnClickEventArgs<T>) =>
                this.handleCellDoubleClick(e as MouseEvent, args),
        );
        this.grid.registerPlugin(this.selector);
        this._handler.subscribe(
            this.selector.onCellRangeSelected,
            async (e: Event, range: Slick.Range) =>
                await this.handleCellRangeSelected(e, range, false),
        );
        this._handler.subscribe(
            this.selector.onAppendCellRangeSelected,
            async (e: Event, range: Slick.Range) =>
                await this.handleCellRangeSelected(e, range, true),
        );

        this._handler.subscribe(
            this.selector.onBeforeCellRangeSelected,
            (e: Event, cell: Slick.Cell) => this.handleBeforeCellRangeSelected(e, cell),
        );
    }

    public destroy() {
        this._handler.unsubscribeAll();
        this.grid.unregisterPlugin(this.selector);
    }

    private removeInvalidRanges(ranges: Array<Slick.Range>): Array<Slick.Range> {
        let result: Array<Slick.Range> = [];

        for (let i = 0; i < ranges.length; i++) {
            let r = ranges[i];
            if (
                this.grid.canCellBeSelected(r.fromRow, r.fromCell) &&
                this.grid.canCellBeSelected(r.toRow, r.toCell)
            ) {
                result.push(r);
            } else if (
                this.grid.canCellBeSelected(r.fromRow, r.fromCell + 1) &&
                this.grid.canCellBeSelected(r.toRow, r.toCell)
            ) {
                // account for number row
                result.push(new Slick.Range(r.fromRow, r.fromCell + 1, r.toRow, r.toCell));
            }
        }

        return result;
    }

    public setSelectedRanges(ranges: Array<Slick.Range>): void {
        // simple check for: empty selection didn't change, prevent firing onSelectedRangesChanged
        if ((!this.ranges || this.ranges.length === 0) && (!ranges || ranges.length === 0)) {
            return;
        }

        this.ranges = this.removeInvalidRanges(ranges);
        this.onSelectedRangesChanged.notify(this.ranges);
    }

    public getSelectedRanges(): Slick.Range[] {
        return this.ranges;
    }

    private handleBeforeCellRangeSelected(e: Event, _args: Slick.Cell) {
        if (this.grid.getEditorLock().isActive()) {
            e.stopPropagation();
            return false;
        }
        return true;
    }

    private async handleCellRangeSelected(_e: Event, range: Slick.Range, append: boolean) {
        this.grid.setActiveCell(range.fromRow, range.fromCell, false, false, true);

        if (append) {
            this.setSelectedRanges(this.insertIntoSelections(this.getSelectedRanges(), range));
        } else {
            this.setSelectedRanges([range]);
        }

        await this.setSelectionSummaryText(true);
    }

    private isMultiSelection(_e: MouseEvent): boolean {
        return this.isMac ? _e.metaKey : _e.ctrlKey;
    }

    private handleHeaderClick(e: MouseEvent, args: Slick.OnHeaderClickEventArgs<T>) {
        if (e.target) {
            if ((e.target as EventTargetWithClassName).className === "slick-resizable-handle") {
                return;
            }
        }
        if (!args) {
            return;
        }
        if (!isUndefinedOrNull(args.column)) {
            const columnIndex = this.grid.getColumnIndex(args.column.id!);
            const rowCount = this.grid.getDataLength();
            const columnCount = this.grid.getColumns().length;
            const currentActiveCell = this.grid.getActiveCell();
            let newActiveCell: Slick.Cell | undefined = undefined;
            if (this.options.hasRowSelector && columnIndex === 0) {
                // When the row selector's header is clicked, all cells should be selected
                this.setSelectedRanges([new Slick.Range(0, 1, rowCount - 1, columnCount - 1)]);
                // The first data cell in the view should be selected.
                newActiveCell = {
                    row: this.grid.getViewport()?.top ?? 0,
                    cell: 1,
                };
            } else if (this.grid.canCellBeSelected(0, columnIndex)) {
                let newSelectedRange: Slick.Range | undefined;
                let rangesToBeMerged: Slick.Range[] = [];
                if (e.shiftKey) {
                    /**
                     * If the user clicks on a column header while holding down the SHIFT key,
                     * we take the current active cell and select all columns from the active cell to the target column.
                     */
                    newSelectedRange = new Slick.Range(
                        0,
                        currentActiveCell ? currentActiveCell.cell : columnIndex,
                        rowCount - 1,
                        columnIndex,
                    );
                } else if (this.isMultiSelection(e)) {
                    /**
                     * If the user clicks on a column header while holding down CTRL key, we select/deselect the entire column.
                     */
                    const currentlySelectedRange = this.getSelectedRanges();
                    let isCurrentColumnAlreadySelected = false;

                    for (const range of currentlySelectedRange) {
                        if (
                            range.fromCell <= columnIndex &&
                            range.toCell >= columnIndex &&
                            range.fromRow === 0 &&
                            range.toRow === rowCount - 1
                        ) {
                            isCurrentColumnAlreadySelected = true;
                            // If there are selections that are to the left of the current column, we need to create new range.

                            if (range.fromCell < columnIndex) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        range.fromRow,
                                        range.fromCell,
                                        range.toRow,
                                        columnIndex - 1,
                                    ),
                                );
                            }
                            if (range.toCell > columnIndex) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        range.fromRow,
                                        columnIndex + 1,
                                        range.toRow,
                                        range.toCell,
                                    ),
                                );
                            }
                        } else {
                            rangesToBeMerged.push(range);
                        }
                    }
                    newSelectedRange =
                        isCurrentColumnAlreadySelected === false
                            ? new Slick.Range(0, columnIndex, rowCount - 1, columnIndex)
                            : undefined;
                } else {
                    /**
                     * If the user clicks on a column header without holding down the SHIFT or CTRL key,
                     * we clear the previous selections and select the entire column.
                     */
                    newSelectedRange = new Slick.Range(0, columnIndex, rowCount - 1, columnIndex);
                }
                let result: Slick.Range[] = [];
                if (newSelectedRange) {
                    result = this.insertIntoSelections(rangesToBeMerged, newSelectedRange!);
                } else {
                    result = rangesToBeMerged;
                }
                this.setSelectedRanges(result);
                // The first data cell of the target column in the view should be selected.
                newActiveCell = {
                    row: this.grid.getViewport()?.top ?? 0,
                    cell: columnIndex,
                };
            }

            if (newActiveCell) {
                this.grid.setActiveCell(newActiveCell.row, newActiveCell.cell);
            }
        }
    }

    private handleCellDoubleClick(_e: MouseEvent, args: Slick.OnClickEventArgs<T>) {
        const columns = this.grid.getColumns();
        const rowRange = new Slick.Range(args.row, 1, args.row, columns.length - 1);
        this.setSelectedRanges([rowRange]);
        const newActiveCell = {
            row: args.row,
            cell: 1,
        };
        this.grid.setActiveCell(newActiveCell.row, newActiveCell.cell);
    }

    /**
     * DO NOT CALL THIS DIRECTLY - GO THROUGH INSERT INTO SELECTIONS
     *
     */
    private mergeSelections(
        ranges: Array<Slick.Range>,
        range: Slick.Range,
    ): { newRanges: Array<Slick.Range>; handled: boolean } {
        // New ranges selection
        let newRanges: Array<Slick.Range> = [];

        // Have we handled this value
        let handled = false;
        for (let current of ranges) {
            // We've already processed everything. Add everything left back to the list.
            if (handled) {
                newRanges.push(current);
                continue;
            }
            let newRange: Slick.Range | undefined = undefined;

            // if the ranges are the same.
            if (
                current.fromRow === range.fromRow &&
                current.fromCell === range.fromCell &&
                current.toRow === range.toRow &&
                current.toCell === range.toCell
            ) {
                // If we're actually not going to handle it during this loop
                // this region will be added with the handled boolean check
                continue;
            }

            // Rows are the same - horizontal merging of the selection area
            if (current.fromRow === range.fromRow && current.toRow === range.toRow) {
                // Check if the new region is adjacent to the old selection group
                if (
                    range.toCell + 1 === current.fromCell ||
                    range.fromCell - 1 === current.toCell
                ) {
                    handled = true;
                    let fromCell = Math.min(
                        range.fromCell,
                        current.fromCell,
                        range.toCell,
                        current.toCell,
                    );
                    let toCell = Math.max(
                        range.fromCell,
                        current.fromCell,
                        range.toCell,
                        current.toCell,
                    );
                    newRange = new Slick.Range(range.fromRow, fromCell, range.toRow, toCell);
                }
                // Cells are the same - vertical merging of the selection area
            } else if (current.fromCell === range.fromCell && current.toCell === range.toCell) {
                // Check if the new region is adjacent to the old selection group
                if (range.toRow + 1 === current.fromRow || range.fromRow - 1 === current.toRow) {
                    handled = true;
                    let fromRow = Math.min(
                        range.fromRow,
                        current.fromRow,
                        range.fromRow,
                        current.fromRow,
                    );
                    let toRow = Math.max(range.toRow, current.toRow, range.toRow, current.toRow);
                    newRange = new Slick.Range(fromRow, range.fromCell, toRow, range.toCell);
                }
            }

            if (newRange) {
                newRanges.push(newRange);
            } else {
                newRanges.push(current);
            }
        }

        if (!handled) {
            newRanges.push(range);
        }

        return {
            newRanges,
            handled,
        };
    }

    public insertIntoSelections(
        ranges: Array<Slick.Range>,
        range: Slick.Range,
    ): Array<Slick.Range> {
        let result = this.mergeSelections(ranges, range);
        let newRanges = result.newRanges;

        // Keep merging the rows until we stop having changes
        let i = 0;
        while (true) {
            if (i++ > 10000) {
                throw new Error("InsertIntoSelection infinite loop");
            }
            let shouldContinue = false;
            for (let current of newRanges) {
                result = this.mergeSelections(newRanges, current);
                if (result.handled) {
                    shouldContinue = true;
                    newRanges = result.newRanges;
                    break;
                }
            }

            if (shouldContinue) {
                continue;
            }
            break;
        }

        return newRanges;
    }

    private async handleCellClick(e: MouseEvent, args: Slick.OnClickEventArgs<T>) {
        const activeCell = this.grid.getActiveCell();
        const columns = this.grid.getColumns();
        const isRowSelectorClicked: boolean | undefined =
            this.options.hasRowSelector && args.cell === 0;
        const selectedRanges = this.getSelectedRanges();

        let newlySelectedRange: Slick.Range | undefined;
        let rangesToBeMerged: Slick.Range[] = [];

        if (isRowSelectorClicked) {
            if (e.shiftKey) {
                rangesToBeMerged = [];
                if (activeCell) {
                    newlySelectedRange = new Slick.Range(
                        activeCell.row,
                        1,
                        args.row,
                        columns.length - 1,
                    );
                } else {
                    newlySelectedRange = new Slick.Range(args.row, 1, args.row, columns.length - 1);
                }
            } else if (this.isMultiSelection(e)) {
                let isCurrentRowAlreadySelected = selectedRanges.some(
                    (range) => range.fromRow <= args.row && range.toRow >= args.row,
                );
                if (isCurrentRowAlreadySelected) {
                    for (const range of selectedRanges) {
                        if (range.fromRow <= args.row && range.toRow >= args.row) {
                            // If the row is already selected, we need to remove it from the selection.
                            // Push the ranges that are above and below the current row
                            if (range.fromRow < args.row) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        range.fromRow,
                                        range.fromCell,
                                        args.row - 1,
                                        range.toCell,
                                    ),
                                );
                            }
                            if (range.toRow > args.row) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        args.row + 1,
                                        range.fromCell,
                                        range.toRow,
                                        range.toCell,
                                    ),
                                );
                            }
                        } else {
                            rangesToBeMerged.push(range);
                        }
                    }
                } else {
                    newlySelectedRange = new Slick.Range(args.row, 1, args.row, columns.length - 1);
                    rangesToBeMerged = selectedRanges;
                }
            } else {
                rangesToBeMerged = [];
                newlySelectedRange = new Slick.Range(args.row, 1, args.row, columns.length - 1);
            }
        } else {
            if (e.shiftKey) {
                rangesToBeMerged = [];
                if (activeCell) {
                    newlySelectedRange = new Slick.Range(
                        activeCell.row,
                        activeCell.cell,
                        args.row,
                        args.cell,
                    );
                } else {
                    newlySelectedRange = new Slick.Range(args.row, args.cell, args.row, args.cell);
                }
            } else if (this.isMultiSelection(e)) {
                const isCurrentCellAlreadySelected = selectedRanges.some(
                    (range) =>
                        range.fromRow <= args.row &&
                        range.toRow >= args.row &&
                        range.fromCell <= args.cell &&
                        range.toCell >= args.cell,
                );
                if (isCurrentCellAlreadySelected) {
                    for (const range of selectedRanges) {
                        if (
                            range.fromRow <= args.row &&
                            range.toRow >= args.row &&
                            range.fromCell <= args.cell &&
                            range.toCell >= args.cell
                        ) {
                            // If the cell is already selected, we need to remove it from the selection.
                            // Push the sub ranges that are above, below, left and right of the current cell
                            if (range.fromRow < args.row) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        range.fromRow,
                                        range.fromCell,
                                        args.row - 1,
                                        range.toCell,
                                    ),
                                );
                            }
                            if (range.toRow > args.row) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        args.row + 1,
                                        range.fromCell,
                                        range.toRow,
                                        range.toCell,
                                    ),
                                );
                            }
                            if (range.fromCell < args.cell) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        args.row,
                                        range.fromCell,
                                        args.row,
                                        args.cell - 1,
                                    ),
                                );
                            }
                            if (range.toCell > args.cell) {
                                rangesToBeMerged.push(
                                    new Slick.Range(
                                        args.row,
                                        args.cell + 1,
                                        args.row,
                                        range.toCell,
                                    ),
                                );
                            }
                        } else {
                            rangesToBeMerged.push(range);
                        }
                    }
                } else {
                    newlySelectedRange = new Slick.Range(args.row, args.cell, args.row, args.cell);
                    rangesToBeMerged = selectedRanges;
                }
            } else {
                rangesToBeMerged = [];
                newlySelectedRange = new Slick.Range(args.row, args.cell, args.row, args.cell);
            }
        }

        let result: Slick.Range[] = [];
        if (newlySelectedRange) {
            result = this.insertIntoSelections(rangesToBeMerged, newlySelectedRange!);
        } else {
            result = rangesToBeMerged;
        }
        this.setSelectedRanges(result);

        // Find out the new active cell
        // If the row selector is clicked, the first data cell in the row should be the new active cell,
        // otherwise, the target cell should be the new active cell.
        const newActiveCell: Slick.Cell = isRowSelectorClicked
            ? { cell: 1, row: args.row }
            : { cell: args.cell, row: args.row };
        this.grid.setActiveCell(newActiveCell.row, newActiveCell.cell);

        await this.setSelectionSummaryText();
    }

    public async handleSelectAll() {
        let ranges: Slick.Range[];
        let startColumn = 0;
        // check for number column
        if (
            !isUndefinedOrNull(this.grid.getColumns()[0].selectable) &&
            !this.grid.getColumns()[0].selectable
        ) {
            startColumn = 1;
        }
        ranges = [
            new Slick.Range(
                0,
                startColumn,
                this.grid.getDataLength() - 1,
                this.grid.getColumns().length - 1,
            ),
        ];
        this.setSelectedRanges(ranges);
    }

    private async handleKeyDown(e: KeyboardEvent): Promise<void> {
        const key = e.key; // e.g., 'a', 'ArrowLeft'
        const metaOrCtrlPressed = this.isMac ? e.metaKey : e.ctrlKey;

        // --- 1) Select All (Cmd/Ctrl + A) ---
        if (metaOrCtrlPressed && key === Keys?.a) {
            e.preventDefault();
            e.stopPropagation();
            await this.handleSelectAll();
            return;
        }

        // --- 2) Range selection via Shift + Arrow (no Alt, no Meta/Ctrl) ---
        const isArrow =
            key === (Keys?.ArrowLeft ?? "ArrowLeft") ||
            key === (Keys?.ArrowRight ?? "ArrowRight") ||
            key === (Keys?.ArrowUp ?? "ArrowUp") ||
            key === (Keys?.ArrowDown ?? "ArrowDown");

        if (!isArrow || !e.shiftKey || metaOrCtrlPressed || e.altKey) {
            return; // Not our concern—let the default handler run
        }

        const active = this.grid.getActiveCell();
        if (!active) {
            return; // Nothing to extend from
        }

        // Grab existing ranges; ensure we have at least one range rooted at active
        let ranges = this.getSelectedRanges();
        if (!ranges?.length) {
            ranges = [new Slick.Range(active.row, active.cell)];
        }

        // keyboard can work with last range only
        let last = ranges.pop()!;

        // If the active cell isn't inside the last range, start a fresh one
        if (!last.contains(active.row, active.cell)) {
            last = new Slick.Range(active.row, active.cell);
        }

        // Determine the "growth" direction relative to the active anchor
        const dirRow = active.row === last.fromRow ? 1 : -1;
        const dirCell = active.cell === last.fromCell ? 1 : -1;

        // Current deltas
        let dRow = last.toRow - last.fromRow;
        let dCell = last.toCell - last.fromCell;

        // Nudge the deltas based on the pressed arrow
        switch (key) {
            case Keys?.ArrowLeft ?? "ArrowLeft":
                dCell -= dirCell;
                break;
            case Keys?.ArrowRight ?? "ArrowRight":
                dCell += dirCell;
                break;
            case Keys?.ArrowUp ?? "ArrowUp":
                dRow -= dirRow;
                break;
            case Keys?.ArrowDown ?? "ArrowDown":
                dRow += dirRow;
                break;
        }

        // Compute new candidate range
        const newRange = new Slick.Range(
            active.row,
            active.cell,
            active.row + dirRow * dRow,
            active.cell + dirCell * dCell,
        );

        // Validate and apply; fall back to previous range if invalid
        const valid = this.removeInvalidRanges([newRange]).length > 0;
        const finalRange = valid ? newRange : last;
        ranges.push(finalRange);

        // Keep the new edge in view
        const viewRow = dirRow > 0 ? finalRange.toRow : finalRange.fromRow;
        const viewCell = dirCell > 0 ? finalRange.toCell : finalRange.fromCell;
        this.grid.scrollRowIntoView(viewRow, false);
        this.grid.scrollCellIntoView(viewRow, viewCell, false);

        // Commit selection and swallow the event
        this.setSelectedRanges(ranges);
        e.preventDefault();
        e.stopPropagation();
    }

    private async setSelectionSummaryText(isSelection?: boolean) {
        await this.context.extensionRpc.sendRequest(SetSelectionSummaryRequest.type, {
            summary: await selectionSummaryHelper(this.getSelectedRanges(), this.grid, isSelection),
        });
    }

    private handleAfterKeyboardNavigationEvent(): void {
        const activeCell = this.grid.getActiveCell();
        if (activeCell) {
            this.setSelectedRanges([new Slick.Range(activeCell.row, activeCell.cell)]);
        }
    }
}

// Public for testing
export async function selectionSummaryHelper(
    selectedRanges: Slick.Range[],
    grid: Slick.Grid<any>,
    isSelection?: boolean,
): Promise<SelectionSummaryStats> {
    let summary: SelectionSummaryStats = {
        count: -1,
        distinctCount: -1,
        nullCount: -1,
        removeSelectionStats: !isSelection,
    };

    if (isSelection) {
        const firstRange = selectedRanges[0];
        if (!firstRange) return summary;

        const column = grid.getColumns()[firstRange.fromCell];
        if (!column) return summary;

        const values: any[] = [];
        let nullCount = 0;
        let numCount = 0;
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;

        for (let row = firstRange.fromRow; row <= firstRange.toRow; row++) {
            for (let col = firstRange.fromCell; col <= firstRange.toCell; col++) {
                const cell = grid.getCellNode(row, col);
                if (!cell) continue;
                const value = cell.innerText;
                if (value === "NULL") {
                    nullCount++;
                } else if (!isNaN(Number(value))) {
                    numCount++;
                    min = Math.min(min, Number(value));
                    max = Math.max(max, Number(value));
                    sum += Number(value);
                }
                values.push(value);
            }
        }

        const count = values.length;
        const distinctCount = new Set(values).size;

        if (numCount) {
            // format average into decimal, up to three places, with no trailing zeros
            const average = (sum / numCount).toFixed(3).replace(/\.?0+$/, "");
            summary = {
                average: average,
                count: count,
                distinctCount: distinctCount,
                max: max,
                min: min,
                nullCount: nullCount,
                sum: sum,
                removeSelectionStats: false,
            };
        } else {
            summary = {
                count: count,
                distinctCount: distinctCount,
                nullCount: nullCount,
                removeSelectionStats: false,
            };
        }
    }

    return summary;
}
