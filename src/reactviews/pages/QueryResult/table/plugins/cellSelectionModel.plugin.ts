/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Drag select selection model gist taken from https://gist.github.com/skoon/5312536
// heavily modified

import { CellRangeSelector, ICellRangeSelector } from "./cellRangeSelector";
import {
    ResultSetSummary,
    SetSelectionSummaryRequest,
} from "../../../../../sharedInterfaces/queryResult";

import { isUndefinedOrNull } from "../tableDataView";
import { mixin } from "../objects";
import { tokens } from "@fluentui/react-components";
import { KeyCode } from "../../../../common/keys";
import { QueryResultReactProvider } from "../../queryResultStateProvider";
import { convertDisplayedSelectionToActual } from "../utils";
import { HeaderMenu } from "./headerFilter.plugin";
import {
    getNextFocusableElementOutside,
    getPreviousFocusableElementOutside,
    isMetaKeyPressed,
} from "../../../../common/utils";

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

    public onSelectedRangesChanged = new Slick.Event<Array<Slick.Range>>();

    constructor(
        private options: ICellSelectionModelOptions = defaults,
        private context: QueryResultReactProvider,
        private uri: string,
        private resultSetSummary: ResultSetSummary,
        private gridId: string,
        private headerFilter?: HeaderMenu<T>,
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

        this._handler.subscribe(this.grid.onActiveCellChanged, async (_e: Event) => {
            if (this.grid.getSelectionModel().getSelectedRanges().length === 0) {
                this.handleAfterKeyboardNavigationEvent();
            }
        });
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
        this.ranges = this.removeInvalidRanges(ranges);
        this.onSelectedRangesChanged.notify(this.ranges);
        void this.updateSummaryText(this.ranges);
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
        let ranges: Slick.Range[] = [];
        if (append) {
            ranges = this.insertIntoSelections(this.getSelectedRanges(), range);
        } else {
            ranges = [range];
        }
        this.setSelectedRanges(ranges);
    }

    private async handleHeaderClick(e: MouseEvent, args: Slick.OnHeaderClickEventArgs<T>) {
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
                } else if (await isMetaKeyPressed(e)) {
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
            } else if (await isMetaKeyPressed(e)) {
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
            } else if (await isMetaKeyPressed(e)) {
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
        const keyCode = e.code;
        const metaOrCtrlPressed = await isMetaKeyPressed(e);
        let isHandled = false;

        // Range selection via Shift + Arrow (no Alt, no Meta/Ctrl)
        const isArrow =
            keyCode === KeyCode.ArrowLeft ||
            keyCode === KeyCode.ArrowRight ||
            keyCode === KeyCode.ArrowUp ||
            keyCode === KeyCode.ArrowDown;

        if (isArrow && e.shiftKey && !e.altKey && !metaOrCtrlPressed) {
            this.expandSelection(keyCode);
            isHandled = true;
        }

        // Open Header menu (F3)
        if (keyCode === KeyCode.F3) {
            await this.headerFilter?.openMenuForActiveColumn();
            isHandled = true;
        }

        // Select All (Cmd/Ctrl + A)
        if (metaOrCtrlPressed && keyCode === KeyCode.KeyA) {
            await this.handleSelectAll();
            isHandled = true;
        }

        // Move to first cell of row (Ctrl + left)
        if (metaOrCtrlPressed && keyCode === KeyCode.ArrowLeft) {
            this.moveToFirstCellInRow();
            isHandled = true;
        }

        // Move to last cell of row (Ctrl + right)
        if (metaOrCtrlPressed && keyCode === KeyCode.ArrowRight) {
            this.moveToLastCellInRow();
            isHandled = true;
        }

        // Select current column (Ctrl + space)
        if (e.ctrlKey && keyCode === KeyCode.Space) {
            this.selectActiveCellColumn();
            isHandled = true;
        }

        // Open context menu (Shift + F10) or ContextMenu key
        if ((e.shiftKey && keyCode === KeyCode.F10) || keyCode === KeyCode.ContextMenu) {
            // Open context menu
            // Already handled by onContextMenu event
            return;
        }

        // Select current row (Shift + space)
        if (e.shiftKey && keyCode === KeyCode.Space) {
            this.selectActiveCellRow();
            isHandled = true;
        }

        // Move focus to previous focusable element outside the grid (Shift + Tab)
        if (e.shiftKey && keyCode === KeyCode.Tab) {
            // Prevent SlickGrid's default Tab behavior and move focus to previous component
            e.stopImmediatePropagation();
            await this.moveFocusToOutsideGrid(false);
            isHandled = true;
        }

        // Move focus to next focusable element outside the grid (Tab)
        if (!e.shiftKey && keyCode === KeyCode.Tab) {
            // Prevent SlickGrid's default Tab behavior and move focus to next component
            e.stopImmediatePropagation();
            await this.moveFocusToOutsideGrid(true);
            isHandled = true;
        }

        // Toggle sort (Shift+Alt+O)
        if (e.shiftKey && e.altKey && keyCode === KeyCode.KeyO && !metaOrCtrlPressed) {
            await this.toggleSortForActiveCell();
            isHandled = true;
        }

        // Resize column (Shift+Alt+S)
        if (keyCode === KeyCode.KeyS && e.shiftKey && e.altKey && !metaOrCtrlPressed) {
            const active = this.grid.getActiveCell();
            if (!active) {
                return;
            }

            const columns = this.grid.getColumns();
            const column = columns[active.cell];
            if (!column) {
                return;
            }

            this.context.openResizeDialog({
                open: true,
                columnId: column.id ?? "",
                columnName: column.name ?? "",
                initialWidth: column.width ?? 0,
                gridId: this.gridId,
                onDismiss: () => {
                    this.headerFilter?.resizeCancel();
                },
                onSubmit: (newWidth: number) => {
                    this.headerFilter?.resizeColumn(column.id ?? "", newWidth);
                },
            });
            isHandled = true;
        }

        if (isHandled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private expandSelection(
        keyCode: KeyCode.ArrowUp | KeyCode.ArrowDown | KeyCode.ArrowLeft | KeyCode.ArrowRight,
    ): void {
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
        switch (keyCode) {
            case KeyCode.ArrowLeft:
                dCell -= dirCell;
                break;
            case KeyCode.ArrowRight:
                dCell += dirCell;
                break;
            case KeyCode.ArrowUp:
                dRow -= dirRow;
                break;
            case KeyCode.ArrowDown:
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

        this.setSelectedRanges(ranges);
    }

    private moveToFirstCellInRow(): void {
        const active = this.grid.getActiveCell();
        if (active) {
            this.grid.setActiveCell(active.row, 1);
            this.grid
                .getSelectionModel()
                .setSelectedRanges([new Slick.Range(active.row, 1, active.row, 1)]);
        }
    }

    private moveToLastCellInRow(): void {
        const active = this.grid.getActiveCell();
        if (active) {
            this.grid.setActiveCell(active.row, this.grid.getColumns().length - 1);
            this.grid
                .getSelectionModel()
                .setSelectedRanges([
                    new Slick.Range(
                        active.row,
                        this.grid.getColumns().length - 1,
                        active.row,
                        this.grid.getColumns().length - 1,
                    ),
                ]);
        }
    }

    private selectActiveCellColumn(): void {
        const active = this.grid.getActiveCell();
        if (active) {
            const rowCount = this.grid.getDataLength();
            const newSelectedRange = new Slick.Range(0, active.cell, rowCount - 1, active.cell);
            this.setSelectedRanges([newSelectedRange]);
            this.grid.setActiveCell(active.row, active.cell);
        }
    }

    private selectActiveCellRow(): void {
        const active = this.grid.getActiveCell();
        if (active) {
            const columnCount = this.grid.getColumns().length;
            const newSelectedRange = new Slick.Range(active.row, 1, active.row, columnCount - 1);
            this.setSelectedRanges([newSelectedRange]);
            this.grid.setActiveCell(active.row, active.cell);
        }
    }

    private async moveFocusToOutsideGrid(forward: boolean): Promise<void> {
        const gridContainer = this.grid.getContainerNode();
        if (gridContainer) {
            let element: HTMLElement | null = null;
            if (forward) {
                element = getNextFocusableElementOutside(gridContainer);
            } else {
                element = getPreviousFocusableElementOutside(gridContainer);
            }
            if (element) {
                element.focus();
            }
        }
    }

    private async toggleSortForActiveCell(): Promise<void> {
        const active = this.grid.getActiveCell();
        if (active && this.headerFilter) {
            await this.headerFilter.toggleSortForColumn(active.cell);
        }
    }

    public async updateSummaryText(ranges?: Slick.Range[]): Promise<void> {
        if (!ranges) {
            ranges = this.getSelectedRanges();
        }
        const simplifiedRanges = ranges.map((range) => ({
            fromRow: range.fromRow,
            fromCell: range.fromCell - 1, // adjust for number column
            toRow: range.toRow,
            toCell: range.toCell - 1, // adjust for number column
        }));
        const actualRanges = convertDisplayedSelectionToActual(this.grid, simplifiedRanges);
        await this.context.extensionRpc.sendNotification(SetSelectionSummaryRequest.type, {
            selection: actualRanges,
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
        });
    }

    private handleAfterKeyboardNavigationEvent(): void {
        const activeCell = this.grid.getActiveCell();
        if (activeCell) {
            this.setSelectedRanges([new Slick.Range(activeCell.row, activeCell.cell)]);
        }
    }
}
