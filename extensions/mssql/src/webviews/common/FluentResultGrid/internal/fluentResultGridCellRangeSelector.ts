/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SlickCellRangeSelector,
    type DragRowMove,
    type SlickEventData,
} from "@slickgrid-universal/common";

export interface FluentResultGridSelectionModifierEvent {
    ctrlKey?: boolean;
    metaKey?: boolean;
}

export function isFluentResultGridAppendSelectionEvent(
    event: FluentResultGridSelectionModifierEvent | undefined,
): boolean {
    return !!(event?.ctrlKey || event?.metaKey);
}

/**
 * SlickGrid applies grid options with a jQuery-style deep extend, which keeps the default array
 * entries when an empty array is supplied. Its drag service captures the resulting array by
 * reference during initialization; clearing that array in place enables modifier drags.
 */
export function enableFluentResultGridModifierDrag(
    preventDragFromKeys: unknown[] | undefined,
): void {
    preventDragFromKeys?.splice(0, preventDragFromKeys.length);
}

/**
 * SlickCellRangeSelector does not forward the native drag event when it publishes the completed
 * range. Expose the modifier state while that synchronous notification is being published so the
 * selection model can distinguish a replacing drag from a Ctrl/Cmd append drag. Matching the
 * modifier at drag end also mirrors the Production Grid behavior.
 */
export class FluentResultGridCellRangeSelector extends SlickCellRangeSelector {
    private _appendToSelection = false;

    get appendToSelection(): boolean {
        return this._appendToSelection;
    }

    protected override handleDragEnd(eventData: SlickEventData, dragData: DragRowMove): void {
        this._appendToSelection = isFluentResultGridAppendSelectionEvent(eventData);
        try {
            // onCellRangeSelected is raised synchronously inside the base implementation.
            super.handleDragEnd(eventData, dragData);
        } finally {
            this._appendToSelection = false;
        }
    }
}
