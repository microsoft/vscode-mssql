/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Simplified cell selection model for the notebook renderer.
// Adapted from QueryResult/table/plugins/cellSelectionModel.plugin.ts,
// stripped of extension-host RPC, WebviewKeyBindings, and ResultSetSummary dependencies.

import {
    CellRangeSelector,
    ICellRangeSelector,
} from "../QueryResult/table/plugins/cellRangeSelector";
import { isMetaOrCtrlKeyPressed } from "../../common/utils";

export interface INotebookCellSelectionModelOptions {
    cellRangeSelector?: ICellRangeSelector<Slick.SlickData>;
    /** Whether the grid has a row selector (row-number) column at index 0. */
    hasRowSelector?: boolean;
}

const defaults: INotebookCellSelectionModelOptions = {
    hasRowSelector: false,
};

export class NotebookCellSelectionModel
    implements Slick.SelectionModel<Slick.SlickData, Array<Slick.Range>>
{
    private grid!: Slick.Grid<Slick.SlickData>;
    private selector: ICellRangeSelector<Slick.SlickData>;
    private ranges: Array<Slick.Range> = [];
    private _handler = new Slick.EventHandler();

    public onSelectedRangesChanged = new Slick.Event<Array<Slick.Range>>();

    constructor(private options: INotebookCellSelectionModelOptions = defaults) {
        this.options = { ...defaults, ...options };
        if (this.options.cellRangeSelector) {
            this.selector = this.options.cellRangeSelector;
        } else {
            this.selector = new CellRangeSelector({
                selectionCss: {
                    border: "2px dashed var(--vscode-focusBorder, #007fd4)",
                },
            });
        }
    }

    public init(grid: Slick.Grid<Slick.SlickData>) {
        this.grid = grid;

        this._handler.subscribe(this.grid.onKeyDown, (e: Slick.DOMEvent) =>
            this.handleKeyDown(e as unknown as KeyboardEvent),
        );
        this._handler.subscribe(this.grid.onAfterKeyboardNavigation, () =>
            this.handleAfterKeyboardNavigation(),
        );
        this._handler.subscribe(
            this.grid.onClick,
            (e: Slick.DOMEvent, args: Slick.OnClickEventArgs<Slick.SlickData>) =>
                this.handleCellClick(e as MouseEvent, args),
        );
        this._handler.subscribe(
            this.grid.onHeaderClick,
            (e: Slick.DOMEvent, args: Slick.OnHeaderClickEventArgs<Slick.SlickData>) =>
                this.handleHeaderClick(e as MouseEvent, args),
        );
        this._handler.subscribe(
            this.grid.onDblClick,
            (_e: Slick.DOMEvent, args: Slick.OnClickEventArgs<Slick.SlickData>) =>
                this.handleCellDoubleClick(args),
        );

        this.grid.registerPlugin(this.selector);

        this._handler.subscribe(
            this.selector.onCellRangeSelected,
            (_e: Event, range: Slick.Range) => this.handleCellRangeSelected(range, false),
        );
        this._handler.subscribe(
            this.selector.onAppendCellRangeSelected,
            (_e: Event, range: Slick.Range) => this.handleCellRangeSelected(range, true),
        );
        this._handler.subscribe(this.selector.onBeforeCellRangeSelected, (e: Event) =>
            this.handleBeforeCellRangeSelected(e),
        );
        this._handler.subscribe(this.grid.onActiveCellChanged, () => {
            if (this.grid.getSelectionModel().getSelectedRanges().length === 0) {
                this.handleAfterKeyboardNavigation();
            }
        });
    }

    public destroy() {
        this._handler.unsubscribeAll();
        this.grid.unregisterPlugin(this.selector);
    }

    // ── Public API ────────────────────────────────────────────────────

    public setSelectedRanges(ranges: Array<Slick.Range>): void {
        this.ranges = this.removeInvalidRanges(ranges);
        this.onSelectedRangesChanged.notify(this.ranges);
    }

    public getSelectedRanges(): Slick.Range[] {
        return this.ranges;
    }

    // ── Range validation ──────────────────────────────────────────────

    private removeInvalidRanges(ranges: Array<Slick.Range>): Array<Slick.Range> {
        const result: Array<Slick.Range> = [];
        for (const r of ranges) {
            if (
                this.grid.canCellBeSelected(r.fromRow, r.fromCell) &&
                this.grid.canCellBeSelected(r.toRow, r.toCell)
            ) {
                result.push(r);
            } else if (
                this.grid.canCellBeSelected(r.fromRow, r.fromCell + 1) &&
                this.grid.canCellBeSelected(r.toRow, r.toCell)
            ) {
                // Account for non-selectable row-number column
                result.push(new Slick.Range(r.fromRow, r.fromCell + 1, r.toRow, r.toCell));
            }
        }
        return result;
    }

    // ── Drag selection ────────────────────────────────────────────────

    private handleBeforeCellRangeSelected(e: Event) {
        if (this.grid.getEditorLock().isActive()) {
            e.stopPropagation();
            return false;
        }
        return true;
    }

    private handleCellRangeSelected(range: Slick.Range, append: boolean) {
        this.grid.setActiveCell(range.fromRow, range.fromCell, false, false, true);
        let ranges: Slick.Range[];
        if (append) {
            ranges = this.insertIntoSelections(this.getSelectedRanges(), range);
        } else {
            ranges = [range];
        }
        this.setSelectedRanges(ranges);
    }

    // ── Header click (column selection) ───────────────────────────────

    private handleHeaderClick(e: MouseEvent, args: Slick.OnHeaderClickEventArgs<Slick.SlickData>) {
        // Ignore clicks on the resize handle
        if (e.target && (e.target as HTMLElement).className === "slick-resizable-handle") {
            return;
        }
        if (!args?.column) {
            return;
        }

        const columnIndex = this.grid.getColumnIndex(args.column.id!);
        const rowCount = this.grid.getDataLength();
        const columnCount = this.grid.getColumns().length;
        const currentActiveCell = this.grid.getActiveCell();
        let newActiveCell: Slick.Cell | undefined;

        if (this.options.hasRowSelector && columnIndex === 0) {
            // Row-selector header click → select all cells
            this.setSelectedRanges([new Slick.Range(0, 1, rowCount - 1, columnCount - 1)]);
            newActiveCell = {
                row: this.grid.getViewport()?.top ?? 0,
                cell: 1,
            };
        } else if (this.grid.canCellBeSelected(0, columnIndex)) {
            let newSelectedRange: Slick.Range | undefined;
            let rangesToBeMerged: Slick.Range[] = [];

            if (e.shiftKey) {
                // Shift+click: extend from active cell column to this column
                newSelectedRange = new Slick.Range(
                    0,
                    currentActiveCell ? currentActiveCell.cell : columnIndex,
                    rowCount - 1,
                    columnIndex,
                );
            } else if (isMetaOrCtrlKeyPressed(e)) {
                // Ctrl/Cmd+click: toggle column selection
                const currentRanges = this.getSelectedRanges();
                let alreadySelected = false;

                for (const range of currentRanges) {
                    if (
                        range.fromCell <= columnIndex &&
                        range.toCell >= columnIndex &&
                        range.fromRow === 0 &&
                        range.toRow === rowCount - 1
                    ) {
                        alreadySelected = true;
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
                if (!alreadySelected) {
                    newSelectedRange = new Slick.Range(0, columnIndex, rowCount - 1, columnIndex);
                }
            } else {
                // Plain click: select entire column
                newSelectedRange = new Slick.Range(0, columnIndex, rowCount - 1, columnIndex);
            }

            let result: Slick.Range[];
            if (newSelectedRange) {
                result = this.insertIntoSelections(rangesToBeMerged, newSelectedRange);
            } else {
                result = rangesToBeMerged;
            }
            this.setSelectedRanges(result);

            newActiveCell = {
                row: this.grid.getViewport()?.top ?? 0,
                cell: columnIndex,
            };
        }

        if (newActiveCell) {
            this.grid.setActiveCell(newActiveCell.row, newActiveCell.cell);
        }
    }

    // ── Double-click (row selection) ──────────────────────────────────

    private handleCellDoubleClick(args: Slick.OnClickEventArgs<Slick.SlickData>) {
        const columns = this.grid.getColumns();
        this.setSelectedRanges([new Slick.Range(args.row, 1, args.row, columns.length - 1)]);
        this.grid.setActiveCell(args.row, 1);
    }

    // ── Cell click (single/multi-cell selection) ──────────────────────

    private handleCellClick(e: MouseEvent, args: Slick.OnClickEventArgs<Slick.SlickData>) {
        const activeCell = this.grid.getActiveCell();
        const columns = this.grid.getColumns();
        const isRowSelectorClicked = this.options.hasRowSelector && args.cell === 0;
        const selectedRanges = this.getSelectedRanges();

        let newlySelectedRange: Slick.Range | undefined;
        let rangesToBeMerged: Slick.Range[] = [];

        if (isRowSelectorClicked) {
            // ── Row-number column click ──
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
            } else if (isMetaOrCtrlKeyPressed(e)) {
                // Toggle row selection
                const isRowSelected = selectedRanges.some(
                    (r) => r.fromRow <= args.row && r.toRow >= args.row,
                );
                if (isRowSelected) {
                    for (const range of selectedRanges) {
                        if (range.fromRow <= args.row && range.toRow >= args.row) {
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
                // Plain click: select single row
                rangesToBeMerged = [];
                newlySelectedRange = new Slick.Range(args.row, 1, args.row, columns.length - 1);
            }
        } else {
            // ── Data cell click ──
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
            } else if (isMetaOrCtrlKeyPressed(e)) {
                // Toggle cell selection
                const isCellSelected = selectedRanges.some(
                    (r) =>
                        r.fromRow <= args.row &&
                        r.toRow >= args.row &&
                        r.fromCell <= args.cell &&
                        r.toCell >= args.cell,
                );
                if (isCellSelected) {
                    for (const range of selectedRanges) {
                        if (
                            range.fromRow <= args.row &&
                            range.toRow >= args.row &&
                            range.fromCell <= args.cell &&
                            range.toCell >= args.cell
                        ) {
                            // Split range around the deselected cell
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
                // Plain click: select single cell
                rangesToBeMerged = [];
                newlySelectedRange = new Slick.Range(args.row, args.cell, args.row, args.cell);
            }
        }

        let result: Slick.Range[];
        if (newlySelectedRange) {
            result = this.insertIntoSelections(rangesToBeMerged, newlySelectedRange);
        } else {
            result = rangesToBeMerged;
        }
        this.setSelectedRanges(result);

        const newActiveCell: Slick.Cell = isRowSelectorClicked
            ? { cell: 1, row: args.row }
            : { cell: args.cell, row: args.row };
        this.grid.setActiveCell(newActiveCell.row, newActiveCell.cell);
    }

    // ── Range merging ─────────────────────────────────────────────────

    private mergeSelections(
        ranges: Array<Slick.Range>,
        range: Slick.Range,
    ): { newRanges: Array<Slick.Range>; handled: boolean } {
        const newRanges: Array<Slick.Range> = [];
        let handled = false;

        for (const current of ranges) {
            if (handled) {
                newRanges.push(current);
                continue;
            }

            // Skip exact duplicates
            if (
                current.fromRow === range.fromRow &&
                current.fromCell === range.fromCell &&
                current.toRow === range.toRow &&
                current.toCell === range.toCell
            ) {
                continue;
            }

            let newRange: Slick.Range | undefined;

            // Horizontal merge: same rows, adjacent columns
            if (current.fromRow === range.fromRow && current.toRow === range.toRow) {
                if (
                    range.toCell + 1 === current.fromCell ||
                    range.fromCell - 1 === current.toCell
                ) {
                    handled = true;
                    const fromCell = Math.min(range.fromCell, current.fromCell);
                    const toCell = Math.max(range.toCell, current.toCell);
                    newRange = new Slick.Range(range.fromRow, fromCell, range.toRow, toCell);
                }
            }
            // Vertical merge: same columns, adjacent rows
            else if (current.fromCell === range.fromCell && current.toCell === range.toCell) {
                if (range.toRow + 1 === current.fromRow || range.fromRow - 1 === current.toRow) {
                    handled = true;
                    const fromRow = Math.min(range.fromRow, current.fromRow);
                    const toRow = Math.max(range.toRow, current.toRow);
                    newRange = new Slick.Range(fromRow, range.fromCell, toRow, range.toCell);
                }
            }

            newRanges.push(newRange ?? current);
        }

        if (!handled) {
            newRanges.push(range);
        }

        return { newRanges, handled };
    }

    public insertIntoSelections(
        ranges: Array<Slick.Range>,
        range: Slick.Range,
    ): Array<Slick.Range> {
        let result = this.mergeSelections(ranges, range);
        let newRanges = result.newRanges;

        // Keep merging until stable
        let iterations = 0;
        while (true) {
            if (iterations++ > 10000) {
                throw new Error("insertIntoSelections infinite loop");
            }
            let shouldContinue = false;
            for (const current of newRanges) {
                result = this.mergeSelections(newRanges, current);
                if (result.handled) {
                    shouldContinue = true;
                    newRanges = result.newRanges;
                    break;
                }
            }
            if (!shouldContinue) {
                break;
            }
        }
        return newRanges;
    }

    // ── Select all ────────────────────────────────────────────────────

    public handleSelectAll() {
        const columns = this.grid.getColumns();
        const startColumn = columns[0]?.selectable === false ? 1 : 0;
        this.setSelectedRanges([
            new Slick.Range(0, startColumn, this.grid.getDataLength() - 1, columns.length - 1),
        ]);
    }

    // ── Keyboard ──────────────────────────────────────────────────────

    private handleKeyDown(e: KeyboardEvent): void {
        let isHandled = false;

        // Ctrl/Cmd+A → select all
        if (isMetaOrCtrlKeyPressed(e) && e.code === "KeyA") {
            this.handleSelectAll();
            isHandled = true;
        }
        // Shift+Arrow → expand selection
        else if (e.shiftKey && !isMetaOrCtrlKeyPressed(e)) {
            switch (e.code) {
                case "ArrowLeft":
                    this.expandSelection("ArrowLeft");
                    isHandled = true;
                    break;
                case "ArrowRight":
                    this.expandSelection("ArrowRight");
                    isHandled = true;
                    break;
                case "ArrowUp":
                    this.expandSelection("ArrowUp");
                    isHandled = true;
                    break;
                case "ArrowDown":
                    this.expandSelection("ArrowDown");
                    isHandled = true;
                    break;
            }
        }

        if (isHandled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private expandSelection(direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
        const active = this.grid.getActiveCell();
        if (!active) {
            return;
        }

        let ranges = this.getSelectedRanges();
        if (!ranges?.length) {
            ranges = [new Slick.Range(active.row, active.cell)];
        }

        let last = ranges.pop()!;
        if (!last.contains(active.row, active.cell)) {
            last = new Slick.Range(active.row, active.cell);
        }

        const dirRow = active.row === last.fromRow ? 1 : -1;
        const dirCell = active.cell === last.fromCell ? 1 : -1;

        let dRow = last.toRow - last.fromRow;
        let dCell = last.toCell - last.fromCell;

        switch (direction) {
            case "ArrowLeft":
                dCell -= dirCell;
                break;
            case "ArrowRight":
                dCell += dirCell;
                break;
            case "ArrowUp":
                dRow -= dirRow;
                break;
            case "ArrowDown":
                dRow += dirRow;
                break;
        }

        const newRange = new Slick.Range(
            active.row,
            active.cell,
            active.row + dirRow * dRow,
            active.cell + dirCell * dCell,
        );

        const valid = this.removeInvalidRanges([newRange]).length > 0;
        const finalRange = valid ? newRange : last;
        ranges.push(finalRange);

        const viewRow = dirRow > 0 ? finalRange.toRow : finalRange.fromRow;
        const viewCell = dirCell > 0 ? finalRange.toCell : finalRange.fromCell;
        this.grid.scrollRowIntoView(viewRow, false);
        this.grid.scrollCellIntoView(viewRow, viewCell, false);

        this.setSelectedRanges(ranges);
    }

    // ── Keyboard navigation sync ──────────────────────────────────────

    private handleAfterKeyboardNavigation(): void {
        const activeCell = this.grid.getActiveCell();
        if (activeCell) {
            this.setSelectedRanges([new Slick.Range(activeCell.row, activeCell.cell)]);
        }
    }
}
