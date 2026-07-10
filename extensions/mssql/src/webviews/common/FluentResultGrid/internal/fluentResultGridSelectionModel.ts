/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SlickHybridSelectionModel,
    SlickRange,
    type HybridSelectionModelOption,
    type OnActiveCellChangedEventArgs,
    type SlickEventData,
} from "@slickgrid-universal/common";

export class FluentResultGridSelectionModel extends SlickHybridSelectionModel {
    /**
     * Armed by a ctrl-click so the activation that follows keeps the
     * irregular selection (the base model would otherwise reset it).
     */
    private preserveRangesOnActiveCellChange = false;

    constructor(options?: Partial<HybridSelectionModelOption>) {
        super(options);
    }

    /**
     * Cell-mode mouse selection (SSMS/Excel parity — the hybrid model only
     * implements modifier clicks for ROW mode):
     * - plain click: the clicked cell becomes the selection (and the anchor)
     * - shift-click: box from the active anchor to the clicked cell; the
     *   anchor stays active so repeated shift-clicks re-extend from it
     * - ctrl-click: toggle the clicked cell in/out of an irregular selection
     * - ctrl+shift-click: add the anchor→cell box to the selection
     */
    protected override handleClick(e: SlickEventData): boolean | void {
        if (this._activeSelectionIsRow) {
            return super.handleClick(e);
        }
        const cell = this._grid.getCellFromEvent(e);
        if (!cell || !this._grid.canCellBeActive(cell.row, cell.cell)) {
            return;
        }
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        if (!ctrl && !shift) {
            // Plain click collapses any multi-selection to the clicked cell.
            // onClick fires BEFORE activation, and with selectActiveRow=false
            // the base active-cell handler leaves ranges alone afterwards.
            this.setSelectedRanges([new SlickRange(cell.row, cell.cell, cell.row, cell.cell)]);
            return;
        }
        const ranges = this.getSelectedRanges().slice();
        if (shift) {
            const anchor = this._grid.getActiveCell();
            const anchorRow = anchor?.row ?? cell.row;
            const anchorCell = anchor?.cell ?? cell.cell;
            const box = new SlickRange(
                Math.min(anchorRow, cell.row),
                Math.min(anchorCell, cell.cell),
                Math.max(anchorRow, cell.row),
                Math.max(anchorCell, cell.cell),
            );
            this.setSelectedRanges(ctrl ? [...ranges, box] : [box]);
            // Keep the anchor cell active: suppress the activation this click
            // would trigger, so the next shift-click extends from the same
            // anchor (Excel/SSMS behavior).
            e.preventDefault();
            e.stopImmediatePropagation();
            return true;
        }
        // ctrl-click: toggle a single cell; activation proceeds so the
        // clicked cell becomes the new anchor.
        const index = ranges.findIndex(
            (range) =>
                range.fromRow === cell.row &&
                range.toRow === cell.row &&
                range.fromCell === cell.cell &&
                range.toCell === cell.cell,
        );
        if (index >= 0) {
            ranges.splice(index, 1);
        } else {
            ranges.push(new SlickRange(cell.row, cell.cell, cell.row, cell.cell));
        }
        this.preserveRangesOnActiveCellChange = true;
        this.setSelectedRanges(ranges);
        return true;
    }

    protected override handleActiveCellChange(
        eventData: SlickEventData,
        args: OnActiveCellChangedEventArgs,
    ): void {
        if (!this._activeSelectionIsRow && this.preserveRangesOnActiveCellChange) {
            this.preserveRangesOnActiveCellChange = false;
            this._prevSelectedRow = undefined;
            return;
        }
        super.handleActiveCellChange(eventData, args);
    }

    protected override handleCellRangeSelected(
        eventData: SlickEventData,
        args: {
            range: SlickRange;
            selectionMode: string;
            allowAutoEdit?: boolean;
            caller: "onCellRangeSelecting" | "onCellRangeSelected";
        },
    ): boolean {
        if (this._activeSelectionIsRow) {
            return super.handleCellRangeSelected(eventData, args);
        }

        if (args.caller === "onCellRangeSelecting") {
            return false;
        }

        this._grid.setActiveCell(
            args.range.fromRow,
            args.range.fromCell,
            args.allowAutoEdit ? undefined : false,
            false,
            true,
        );
        this.setSelectedRanges([args.range], undefined, args.selectionMode);
        return true;
    }
}
