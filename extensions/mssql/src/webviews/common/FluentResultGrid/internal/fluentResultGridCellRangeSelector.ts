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
 * True when a drag gesture was started with a mouse button other than the primary one.
 *
 * SlickEventData proxies the native event's properties but does not declare them, so the button
 * is read from either the wrapper or the native event it carries. Touch and keyboard gestures
 * report no button and are always treated as primary.
 */
export function isFluentResultGridSecondaryButtonEvent(event: unknown): boolean {
    const source = event as
        | { button?: number; nativeEvent?: { button?: number } | null }
        | null
        | undefined;
    const button = source?.button ?? source?.nativeEvent?.button;
    return button !== undefined && button !== 0;
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

    /**
     * Range selection is a primary-button gesture. The drag service this grid uses binds
     * `mousedown` for every button, so without this a right-click that moves even slightly is
     * processed as a fresh single-cell drag and replaces a Ctrl/Cmd-built selection before the
     * context menu opens. The Production Grid gets the same protection from its drag library.
     */
    protected override handleDragInit(eventData: SlickEventData, dragData: DragRowMove): void {
        if (isFluentResultGridSecondaryButtonEvent(eventData)) {
            return;
        }
        super.handleDragInit(eventData, dragData);
    }

    protected override handleDragStart(
        eventData: SlickEventData,
        dragData: DragRowMove,
    ): HTMLDivElement | undefined {
        if (isFluentResultGridSecondaryButtonEvent(eventData)) {
            return undefined;
        }
        return super.handleDragStart(eventData, dragData);
    }

    protected override handleDragEnd(eventData: SlickEventData, dragData: DragRowMove): void {
        if (isFluentResultGridSecondaryButtonEvent(eventData)) {
            return;
        }

        this._appendToSelection = isFluentResultGridAppendSelectionEvent(eventData);
        try {
            // onCellRangeSelected is raised synchronously inside the base implementation.
            super.handleDragEnd(eventData, dragData);
        } finally {
            this._appendToSelection = false;
        }
    }
}
