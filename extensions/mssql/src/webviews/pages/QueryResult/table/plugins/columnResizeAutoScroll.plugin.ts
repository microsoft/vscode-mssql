/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from "../dom";
import { MouseButton } from "../../../../common/utils";

const RESIZE_AUTOSCROLL_EDGE_THRESHOLD_PX = 32;
const RESIZE_AUTOSCROLL_MAX_STEP_PX = 24;

interface ColumnResizeDragState {
    handle: HTMLElement;
    viewport: HTMLElement;
    pointerClientX: number;
    scrollDeltaX: number;
    animationFrameId?: number;
}

interface JQueryDragSpecialEvent {
    hijack: (
        event: JQuery.TriggeredEvent,
        type: string,
        dd: {
            interactions?: Array<{
                drag?: HTMLElement;
            }>;
            mousedown?: HTMLElement;
        },
        x?: number,
        elem?: Element,
    ) => any;
}

let activeColumnResizeDragState: ColumnResizeDragState | undefined;
let isColumnResizeDragPageXPatchInstalled = false;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function installColumnResizeDragPageXPatch(): void {
    if (isColumnResizeDragPageXPatchInstalled || typeof jQuery === "undefined") {
        return;
    }

    const dragSpecial = jQuery.event?.special?.drag as JQueryDragSpecialEvent | undefined;
    if (!dragSpecial) {
        return;
    }

    const originalHijack = dragSpecial.hijack;
    dragSpecial.hijack = function (
        event: JQuery.TriggeredEvent,
        type: string,
        dd: {
            interactions?: Array<{
                drag?: HTMLElement;
            }>;
            mousedown?: HTMLElement;
        },
        x?: number,
        elem?: Element,
    ) {
        const columnResizeDragState = activeColumnResizeDragState;
        const dragHandle = dd?.mousedown ?? dd?.interactions?.[0]?.drag;
        const shouldAdjustPageX =
            type === "drag" &&
            !!columnResizeDragState &&
            dragHandle === columnResizeDragState.handle &&
            typeof event.pageX === "number";

        if (!shouldAdjustPageX) {
            return originalHijack.call(this, event, type, dd, x, elem);
        }

        const originalPageX = event.pageX as number;
        event.pageX = originalPageX + columnResizeDragState.scrollDeltaX;
        try {
            return originalHijack.call(this, event, type, dd, x, elem);
        } finally {
            event.pageX = originalPageX;
        }
    };

    isColumnResizeDragPageXPatchInstalled = true;
}

export class ColumnResizeAutoScroll<T extends Slick.SlickData> implements Slick.Plugin<T> {
    private _grid!: Slick.Grid<T>;
    private _mouseDownListener?: ReturnType<typeof DOM.addDisposableListener>;
    private _pointerMoveListener?: ReturnType<typeof DOM.addDisposableListener>;
    private _pointerUpListener?: ReturnType<typeof DOM.addDisposableListener>;

    constructor(private readonly onViewportAutoScroll?: () => void) {
        installColumnResizeDragPageXPatch();
    }

    public init(grid: Slick.Grid<T>): void {
        this._grid = grid;
        this.registerColumnResizeAutoScroll();
    }

    public destroy(): void {
        this.stopColumnResizeAutoScroll();
        this._mouseDownListener?.dispose();
        this._mouseDownListener = undefined;
    }

    private registerColumnResizeAutoScroll(): void {
        this._mouseDownListener?.dispose();
        this._mouseDownListener = DOM.addDisposableListener(
            this._grid.getContainerNode(),
            DOM.EventType.MOUSE_DOWN,
            (event: MouseEvent) => {
                if (event.button !== MouseButton.LeftClick) {
                    return;
                }

                const resizeHandle = (event.target as HTMLElement | null)?.closest?.(
                    ".slick-resizable-handle",
                ) as HTMLElement | null;
                if (!resizeHandle) {
                    return;
                }

                this.startColumnResizeAutoScroll(resizeHandle, event);
            },
            true,
        );
    }

    private startColumnResizeAutoScroll(
        handle: HTMLElement,
        event: MouseEvent | JQuery.TriggeredEvent,
    ): void {
        const viewport = this.getViewportElement();
        if (!viewport) {
            return;
        }

        this.stopColumnResizeAutoScroll();
        activeColumnResizeDragState = {
            handle,
            viewport,
            pointerClientX:
                typeof event.pageX === "number" ? event.pageX - window.scrollX : window.innerWidth,
            scrollDeltaX: 0,
        };

        this._pointerMoveListener = DOM.addDisposableListener(
            document,
            DOM.EventType.MOUSE_MOVE,
            (mouseEvent: MouseEvent) => {
                if (activeColumnResizeDragState?.handle !== handle) {
                    return;
                }
                activeColumnResizeDragState.pointerClientX = mouseEvent.clientX;
            },
            true,
        );
        this._pointerUpListener = DOM.addDisposableListener(
            document,
            DOM.EventType.MOUSE_UP,
            () => {
                this.stopColumnResizeAutoScroll();
            },
            true,
        );

        const tick = () => {
            if (activeColumnResizeDragState?.handle !== handle) {
                return;
            }

            this.autoScrollViewportWhileResizing(activeColumnResizeDragState);
            activeColumnResizeDragState.animationFrameId = requestAnimationFrame(tick);
        };
        activeColumnResizeDragState.animationFrameId = requestAnimationFrame(tick);
    }

    private stopColumnResizeAutoScroll(): void {
        const state = activeColumnResizeDragState;
        if (state?.animationFrameId !== undefined) {
            cancelAnimationFrame(state.animationFrameId);
        }
        activeColumnResizeDragState = undefined;

        this._pointerMoveListener?.dispose();
        this._pointerMoveListener = undefined;
        this._pointerUpListener?.dispose();
        this._pointerUpListener = undefined;
    }

    private autoScrollViewportWhileResizing(state: ColumnResizeDragState): void {
        const viewport = state.viewport;
        const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
        if (maxScrollLeft <= 0) {
            return;
        }

        const bounds = viewport.getBoundingClientRect();
        let scrollStepPx = 0;
        if (
            state.pointerClientX >= bounds.right - RESIZE_AUTOSCROLL_EDGE_THRESHOLD_PX &&
            viewport.scrollLeft < maxScrollLeft
        ) {
            const edgePressure =
                state.pointerClientX - (bounds.right - RESIZE_AUTOSCROLL_EDGE_THRESHOLD_PX);
            scrollStepPx = clamp(Math.ceil(edgePressure / 4), 1, RESIZE_AUTOSCROLL_MAX_STEP_PX);
        } else if (
            state.pointerClientX <= bounds.left + RESIZE_AUTOSCROLL_EDGE_THRESHOLD_PX &&
            viewport.scrollLeft > 0
        ) {
            const edgePressure =
                bounds.left + RESIZE_AUTOSCROLL_EDGE_THRESHOLD_PX - state.pointerClientX;
            scrollStepPx = -clamp(Math.ceil(edgePressure / 4), 1, RESIZE_AUTOSCROLL_MAX_STEP_PX);
        }

        if (scrollStepPx === 0) {
            return;
        }

        const currentScrollLeft = viewport.scrollLeft;
        const nextScrollLeft = clamp(currentScrollLeft + scrollStepPx, 0, maxScrollLeft);
        const actualScrollDelta = nextScrollLeft - currentScrollLeft;
        if (actualScrollDelta === 0) {
            return;
        }

        viewport.scrollLeft = nextScrollLeft;
        state.scrollDeltaX += actualScrollDelta;
        this.onViewportAutoScroll?.();
    }

    private getViewportElement(): HTMLElement | undefined {
        return (
            this._grid.getContainerNode().querySelector<HTMLElement>(".slick-viewport") ?? undefined
        );
    }
}
