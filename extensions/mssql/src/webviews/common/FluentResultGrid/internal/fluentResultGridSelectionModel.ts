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
import { FluentResultGridCellRangeSelector } from "./fluentResultGridCellRangeSelector";
import {
    getFluentResultGridRangesAfterClick,
    getFluentResultGridRangesAfterDrag,
} from "./fluentResultGridSelection";

export class FluentResultGridSelectionModel extends SlickHybridSelectionModel {
    private readonly _cellRangeSelector: FluentResultGridCellRangeSelector;
    private _selectionBeforeCellRange: SlickRange[] = [];
    private _settingActiveCellFromRange = false;

    constructor(options?: Partial<HybridSelectionModelOption>) {
        const cellRangeSelector = new FluentResultGridCellRangeSelector();
        super({ ...options, cellRangeSelector });
        this._cellRangeSelector = cellRangeSelector;
    }

    protected override handleActiveCellChange(
        eventData: SlickEventData,
        args: OnActiveCellChangedEventArgs,
    ): void {
        super.handleActiveCellChange(eventData, args);

        if (
            this._settingActiveCellFromRange ||
            this._activeSelectionIsRow ||
            !this._options?.selectActiveCell ||
            args.row === undefined ||
            args.cell === undefined
        ) {
            return;
        }

        // SlickGrid tracks its active cell separately from its selected ranges. Keep the two in
        // sync so a click has an unambiguous selection and Ctrl/Cmd+C copies the clicked cell.
        this.setSelectedRanges([new SlickRange(args.row, args.cell)], undefined, "");
    }

    protected override handleClick(eventData: SlickEventData): boolean | void {
        if (this._activeSelectionIsRow) {
            return super.handleClick(eventData);
        }

        const cell = this._grid.getCellFromEvent(eventData);
        if (!cell || !this._grid.canCellBeActive(cell.row, cell.cell)) {
            return false;
        }

        this.setSelectedRanges(
            getFluentResultGridRangesAfterClick(
                this.getSelectedRanges(),
                cell,
                this._grid.getActiveCell(),
                {
                    ctrlKey: eventData.ctrlKey,
                    metaKey: eventData.metaKey,
                    shiftKey: eventData.shiftKey,
                },
            ),
            undefined,
            "",
        );

        // Own the entire click transaction. If SlickGrid continues processing this event it will
        // set the active cell again and onActiveCellChanged can replace the ranges computed above.
        this._grid.setActiveCell(cell.row, cell.cell, false, false, true);
        eventData.stopImmediatePropagation();
        return true;
    }

    protected override handleBeforeCellRangeSelected(
        eventData: SlickEventData,
        cell: { row: number; cell: number },
    ): boolean | void {
        const result = super.handleBeforeCellRangeSelected(eventData, cell);
        if (result === false) {
            return false;
        }

        this._selectionBeforeCellRange = this.getSelectedRanges().slice();

        // Match the Production Grid: the drag anchor becomes active immediately, while the
        // previous selected ranges remain intact until the gesture is committed.
        try {
            this._settingActiveCellFromRange = true;
            this._grid.setActiveCell(cell.row, cell.cell, false, false, true);
        } finally {
            this._settingActiveCellFromRange = false;
        }
        return result;
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

        try {
            this._settingActiveCellFromRange = true;
            this._grid.setActiveCell(
                args.range.fromRow,
                args.range.fromCell,
                args.allowAutoEdit ? undefined : false,
                false,
                true,
            );

            const selectedRanges = getFluentResultGridRangesAfterDrag(
                this._selectionBeforeCellRange,
                args.range,
                this.gridOptions.multiSelect !== false && this._cellRangeSelector.appendToSelection,
            );
            this.setSelectedRanges(selectedRanges, undefined, args.selectionMode);
        } finally {
            this._settingActiveCellFromRange = false;
            this._selectionBeforeCellRange = [];
        }
        return true;
    }
}
