/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SlickHybridSelectionModel,
    SlickRange,
    type HybridSelectionModelOption,
    type SlickEventData,
} from "@slickgrid-universal/common";

export class FluentResultGridSelectionModel extends SlickHybridSelectionModel {
    constructor(options?: Partial<HybridSelectionModelOption>) {
        super(options);
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

        this.setSelectedRanges([args.range], undefined, args.selectionMode);
        return true;
    }
}
