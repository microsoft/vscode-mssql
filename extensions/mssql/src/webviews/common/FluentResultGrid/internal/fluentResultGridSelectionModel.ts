/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SlickHybridSelectionModel,
    type HybridSelectionModelOption,
    type SlickEventData,
} from "@slickgrid-universal/common";
import { getFluentResultGridRowNumberClickSelection } from "./fluentResultGridSelection";
import { FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID } from "./fluentResultGridConstants";

/**
 * Adds row-number gutter selection to the base cell selection model.
 *
 * Everything else this class used to override — Shift-click ranges, Ctrl/Cmd append, keeping the
 * active cell in sync with the selected range, and multi-range drags — is handled by
 * SlickHybridSelectionModel itself as of slickgrid-universal 10.10.0.
 */
export class FluentResultGridSelectionModel extends SlickHybridSelectionModel {
    constructor(options?: Partial<HybridSelectionModelOption>) {
        super(options);
    }

    protected override handleClick(eventData: SlickEventData): boolean | void {
        if (this._activeSelectionIsRow) {
            return super.handleClick(eventData);
        }

        const cell = this._grid.getCellFromEvent(eventData);
        if (!cell) {
            return super.handleClick(eventData);
        }

        const columns = this._grid.getColumns();

        /**
         * The row-number column is not a data cell, so it never passes canCellBeActive. Resolve it
         * before delegating: a click there selects whole rows, honouring Ctrl/Cmd and Shift.
         *
         * The base model routes this kind of click through `rowSelectColumnIds`, but that option is
         * only consulted when `selectionType` is not "cell" (see `rowSelectionModelIsActive`), and
         * this grid is deliberately cell-selection only.
         */
        const rowNumberSelection = getFluentResultGridRowNumberClickSelection(
            this.getSelectedRanges(),
            cell,
            this._grid.getActiveCell(),
            {
                ctrlKey: eventData.ctrlKey,
                metaKey: eventData.metaKey,
                shiftKey: eventData.shiftKey,
            },
            columns.length,
            columns[0]?.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
            columns,
        );
        if (rowNumberSelection) {
            this.setSelectedRanges(rowNumberSelection.ranges, undefined, "");
            this._grid.setActiveCell(
                rowNumberSelection.activeCell.row,
                rowNumberSelection.activeCell.cell,
                false,
                false,
                true,
            );
            eventData.stopImmediatePropagation();
            return true;
        }

        return super.handleClick(eventData);
    }
}
