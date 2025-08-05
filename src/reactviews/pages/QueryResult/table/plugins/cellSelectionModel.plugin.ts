/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Drag select selection model gist taken from https://gist.github.com/skoon/5312536
// heavily modified

import { CellRangeSelector, ICellRangeSelector } from "./cellRangeSelector";
import {
    ISlickRange,
    QueryResultReducers,
    QueryResultWebviewState,
    SelectionSummaryStats,
    SetSelectionSummaryRequest,
} from "../../../../../sharedInterfaces/queryResult";

import { VscodeWebviewContext } from "../../../../common/vscodeWebviewProvider";
// import { convertJQueryKeyDownEvent } from 'sql/base/browser/dom';
import { isUndefinedOrNull } from "../tableDataView";
import { mixin } from "../objects";
import { tokens } from "@fluentui/react-components";
import { Keys } from "../../../../common/keys";

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
    private webViewState: VscodeWebviewContext<QueryResultWebviewState, QueryResultReducers>;
    private isMac: boolean | undefined;

    /**
     * Since header do not have double click event, we need to track the last header click time and column
     * to determine if the next click is a double click.
     */
    private _lastHeaderClickTime: number = 0;
    private _lastHeaderClickColumn: Slick.Column<T> | null = null;
    private readonly _doubleClickDelayThreshold = 500; // 500ms

    public onSelectedRangesChanged = new Slick.Event<Array<Slick.Range>>();

    constructor(
        private options: ICellSelectionModelOptions = defaults,
        webViewState: VscodeWebviewContext<QueryResultWebviewState, QueryResultReducers>,
    ) {
        this.webViewState = webViewState;
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
        this.webViewState.state.selection = JSON.parse(
            JSON.stringify(this.ranges),
        ) as ISlickRange[];
        // Adjust selection to account for number column
        this.webViewState.state.selection.forEach((range) => {
            range.fromCell = range.fromCell - 1;
            range.toCell = range.toCell - 1;
        });
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

            // Check for double-click on header
            const now = Date.now();
            const isDoubleClick =
                now - this._lastHeaderClickTime < this._doubleClickDelayThreshold &&
                this._lastHeaderClickColumn === args.column;

            this._lastHeaderClickTime = now;
            this._lastHeaderClickColumn = args.column;

            if (isDoubleClick) {
                if (this.options.hasRowSelector && columnIndex === 0) {
                    this.setSelectedRanges([new Slick.Range(0, 1, rowCount - 1, columnCount - 1)]);
                    newActiveCell = {
                        row: this.grid.getViewport()?.top ?? 0,
                        cell: 1,
                    };
                } else if (this.grid.canCellBeSelected(0, columnIndex)) {
                    const columnRange = new Slick.Range(0, columnIndex, rowCount - 1, columnIndex);
                    this.setSelectedRanges([columnRange]);
                    newActiveCell = {
                        row: this.grid.getViewport()?.top ?? 0,
                        cell: columnIndex,
                    };
                }
            } else {
                if (this.options.hasRowSelector && columnIndex === 0) {
                    // When the row selector's header is clicked, all cells should be selected
                    this.setSelectedRanges([new Slick.Range(0, 1, rowCount - 1, columnCount - 1)]);
                    // The first data cell in the view should be selected.
                    newActiveCell = {
                        row: this.grid.getViewport()?.top ?? 0,
                        cell: 1,
                    };
                } else if (this.grid.canCellBeSelected(0, columnIndex)) {
                    // When SHIFT is pressed, all the columns between active cell's column and target column should be selected
                    const newlySelectedRange =
                        e.shiftKey && currentActiveCell
                            ? new Slick.Range(0, currentActiveCell.cell, rowCount - 1, columnIndex)
                            : new Slick.Range(0, columnIndex, rowCount - 1, columnIndex);

                    // When CTRL is pressed, we need to merge the new selection with existing selections
                    const rangesToBeMerged: Slick.Range[] = this.isMultiSelection(e)
                        ? this.getSelectedRanges()
                        : [];
                    const result = this.insertIntoSelections(rangesToBeMerged, newlySelectedRange);
                    this.setSelectedRanges(result);
                    // The first data cell of the target column in the view should be selected.
                    newActiveCell = {
                        row: this.grid.getViewport()?.top ?? 0,
                        cell: columnIndex,
                    };
                }
            }

            if (newActiveCell) {
                this.grid.setActiveCell(newActiveCell.row, newActiveCell.cell);
            }
        }
    }

    private handleCellDoubleClick(e: MouseEvent, args: Slick.OnClickEventArgs<T>) {
        const isRowSelectorClicked: boolean | undefined =
            this.options.hasRowSelector && args.cell === 0;

        if (isRowSelectorClicked) {
            const columns = this.grid.getColumns();
            const rowRange = new Slick.Range(args.row, 1, args.row, columns.length - 1);
            this.setSelectedRanges([rowRange]);
            const newActiveCell = {
                row: args.row,
                cell: 1,
            };
            this.grid.setActiveCell(newActiveCell.row, newActiveCell.cell);
        }
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

        let newlySelectedRange: Slick.Range;
        // The selection is a range when there is an active cell and the SHIFT key is pressed.
        if (activeCell !== undefined && e.shiftKey) {
            // When the row selector cell is clicked, the new selection is all rows from current active row to target row.
            // Otherwise, the new selection is the cells in the rectangle between current active cell and target cell.
            newlySelectedRange = isRowSelectorClicked
                ? new Slick.Range(activeCell.row, columns.length - 1, args.row, 1)
                : new Slick.Range(activeCell.row, activeCell.cell, args.row, args.cell);
        } else {
            // If the row selector cell is clicked, the new selection is all the cells in the target row.
            // Otherwise, the new selection is the target cell
            newlySelectedRange = isRowSelectorClicked
                ? new Slick.Range(args.row, 1, args.row, columns.length - 1)
                : new Slick.Range(args.row, args.cell, args.row, args.cell);
        }

        // When the CTRL key is pressed, we need to merge the new selection with the existing selections.
        const rangesToBeMerged: Slick.Range[] = this.isMultiSelection(e)
            ? this.getSelectedRanges()
            : [];
        const result = this.insertIntoSelections(rangesToBeMerged, newlySelectedRange);
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
        let handled = false;
        if (this.isMac) {
            // Cmd + A
            if (e.metaKey && e.key === Keys.a) {
                handled = true;
                await this.handleSelectAll();
            }
        } else {
            if (e.ctrlKey && e.key === Keys.a) {
                handled = true;
                await this.handleSelectAll();
            }
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private async setSelectionSummaryText(isSelection?: boolean) {
        await this.webViewState.extensionRpc.sendRequest(SetSelectionSummaryRequest.type, {
            summary: await selectionSummaryHelper(this.getSelectedRanges(), this.grid, isSelection),
        });
    }

    // private handleKeyDown(e: StandardKeyboardEvent) {
    // 	let active = this.grid.getActiveCell();
    // 	let metaKey = e.ctrlKey || e.metaKey;

    // 	if (active && e.shiftKey && !metaKey && !e.altKey &&
    // 		(e.keyCode === KeyCode.LeftArrow || e.keyCode === KeyCode.RightArrow || e.keyCode === KeyCode.UpArrow || e.keyCode === KeyCode.DownArrow)) {
    // 		let ranges = this.getSelectedRanges(), last: Slick.Range;

    // 		ranges = this.getSelectedRanges();
    // 		if (!ranges.length) {
    // 			ranges.push(new Slick.Range(active.row, active.cell));
    // 		}

    // 		// keyboard can work with last range only
    // 		last = ranges.pop()!; // this is guarenteed since if ranges is empty we add one

    // 		// can't handle selection out of active cell
    // 		if (!last.contains(active.row, active.cell)) {
    // 			last = new Slick.Range(active.row, active.cell);
    // 		}

    // 		let dRow = last.toRow - last.fromRow,
    // 			dCell = last.toCell - last.fromCell,
    // 			// walking direction
    // 			dirRow = active.row === last.fromRow ? 1 : -1,
    // 			dirCell = active.cell === last.fromCell ? 1 : -1;

    // 		if (e.keyCode === KeyCode.LeftArrow) {
    // 			dCell -= dirCell;
    // 		} else if (e.keyCode === KeyCode.RightArrow) {
    // 			dCell += dirCell;
    // 		} else if (e.keyCode === KeyCode.UpArrow) {
    // 			dRow -= dirRow;
    // 		} else if (e.keyCode === KeyCode.DownArrow) {
    // 			dRow += dirRow;
    // 		}

    // 		// define new selection range
    // 		let new_last = new Slick.Range(active.row, active.cell, active.row + dirRow * dRow, active.cell + dirCell * dCell);
    // 		if (this.removeInvalidRanges([new_last]).length) {
    // 			ranges.push(new_last);
    // 			let viewRow = dirRow > 0 ? new_last.toRow : new_last.fromRow;
    // 			let viewCell = dirCell > 0 ? new_last.toCell : new_last.fromCell;
    // 			this.grid.scrollRowIntoView(viewRow, false);
    // 			this.grid.scrollCellIntoView(viewRow, viewCell, false);
    // 		} else {
    // 			ranges.push(last);
    // 		}

    // 		this.setSelectedRanges(ranges);

    // 		e.preventDefault();
    // 		e.stopPropagation();
    // 	}
    // }

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
