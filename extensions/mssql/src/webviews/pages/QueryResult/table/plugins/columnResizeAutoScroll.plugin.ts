/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ColumnResizeAutoScrollOptions extends Slick.PluginOptions {
    minColumnWidth: number;
    edgeThresholdPx?: number;
    scrollStepPx?: number;
    scrollIntervalMs?: number;
}

interface ResizeState {
    columnId: string;
    startPageX: number;
    lastPageX: number;
    startWidth: number;
    autoScrollDeltaX: number;
    activeHeader: HTMLElement;
    activeHandle?: HTMLElement;
    activePointerId?: number;
    changed: boolean;
    usingPointerEvents: boolean;
}

const defaultOptions = {
    edgeThresholdPx: 2,
    scrollStepPx: 18,
    scrollIntervalMs: 30,
};

export function getColumnResizeWidth(
    startWidth: number,
    pointerDeltaX: number,
    autoScrollDeltaX: number,
    minWidth: number,
    maxWidth?: number,
): number {
    const unclampedWidth = startWidth + pointerDeltaX + autoScrollDeltaX;
    const widthWithMin = Math.max(minWidth, unclampedWidth);
    return maxWidth ? Math.min(maxWidth, widthWithMin) : widthWithMin;
}

export class ColumnResizeAutoScroll<T extends Slick.SlickData> implements Slick.Plugin<T> {
    private grid!: Slick.Grid<T>;
    private container?: HTMLElement;
    private options: Required<ColumnResizeAutoScrollOptions>;
    private resizeState?: ResizeState;
    private autoScrollTimer?: ReturnType<typeof setInterval>;
    private autoScrollDirection: -1 | 0 | 1 = 0;

    constructor(options: ColumnResizeAutoScrollOptions) {
        this.options = {
            ...defaultOptions,
            ...options,
        };
    }

    public init(grid: Slick.Grid<T>): void {
        this.grid = grid;
        this.container = grid.getContainerNode();
        this.container.addEventListener("pointerdown", this.handlePointerDown, true);
        this.container.addEventListener("mousedown", this.handleMouseDown, true);
    }

    public destroy(): void {
        this.stopResize();
        this.container?.removeEventListener("pointerdown", this.handlePointerDown, true);
        this.container?.removeEventListener("mousedown", this.handleMouseDown, true);
        this.container = undefined;
    }

    private handlePointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }

        const handle = this.getResizeHandle(event.target);
        if (!handle) {
            return;
        }

        this.suppressLegacyResize(event);
        this.startResize(event, handle, true, event.pointerId);
    };

    private handleMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) {
            return;
        }

        const handle = this.getResizeHandle(event.target);
        if (!handle) {
            return;
        }

        if (this.resizeState?.usingPointerEvents) {
            this.suppressLegacyResize(event);
            return;
        }

        this.suppressLegacyResize(event);
        this.startResize(event, handle, false);
    };

    private startResize(
        event: MouseEvent | PointerEvent,
        resizeHandle: HTMLElement,
        usingPointerEvents: boolean,
        pointerId?: number,
    ): void {
        const header = resizeHandle.closest(".slick-header-column") as HTMLElement | null;
        if (!header) {
            return;
        }

        const column = this.getColumnFromHeader(header);
        if (!column?.id || column.resizable === false) {
            return;
        }

        this.stopResize();
        header.classList.add("slick-header-column-active");

        if (
            usingPointerEvents &&
            pointerId !== undefined &&
            typeof resizeHandle.setPointerCapture === "function"
        ) {
            resizeHandle.setPointerCapture(pointerId);
        }

        this.resizeState = {
            columnId: column.id,
            startPageX: event.pageX,
            lastPageX: event.pageX,
            startWidth: column.width ?? header.offsetWidth,
            autoScrollDeltaX: 0,
            activeHeader: header,
            activeHandle: resizeHandle,
            activePointerId: pointerId,
            changed: false,
            usingPointerEvents,
        };

        if (usingPointerEvents) {
            document.body.addEventListener("pointermove", this.handlePointerMove);
            document.body.addEventListener("pointerup", this.handlePointerUp);
            document.body.addEventListener("pointercancel", this.handlePointerUp);
            resizeHandle.addEventListener("lostpointercapture", this.handlePointerUp);
        } else {
            document.body.addEventListener("mousemove", this.handleMouseMove);
            document.body.addEventListener("mouseup", this.handleMouseUp);
        }
    }

    private handlePointerMove = (event: PointerEvent): void => {
        const state = this.resizeState;
        if (!state || event.pointerId !== state.activePointerId) {
            return;
        }

        event.preventDefault();
        this.updateResize(event.clientX, event.pageX);
    };

    private handleMouseMove = (event: MouseEvent): void => {
        event.preventDefault();
        this.updateResize(event.clientX, event.pageX);
    };

    private handlePointerUp = (event: PointerEvent): void => {
        const state = this.resizeState;
        if (!state || event.pointerId !== state.activePointerId) {
            return;
        }

        this.stopResize();
    };

    private handleMouseUp = (): void => {
        this.stopResize();
    };

    private updateResize(clientX: number, pageX: number): void {
        const state = this.resizeState;
        if (!state) {
            return;
        }

        state.lastPageX = pageX;
        this.updateAutoScrollDirection(clientX);
        this.applyResize();
    }

    private applyResize(): void {
        const state = this.resizeState;
        if (!state) {
            return;
        }

        const columns = this.grid.getColumns();
        const column = columns.find((candidate) => candidate.id === state.columnId);
        if (!column) {
            return;
        }

        const minWidth = Math.max(column.minWidth ?? 0, this.options.minColumnWidth);
        const newWidth = getColumnResizeWidth(
            state.startWidth,
            state.lastPageX - state.startPageX,
            state.autoScrollDeltaX,
            minWidth,
            column.maxWidth,
        );

        if (column.width === newWidth) {
            return;
        }

        column.width = newWidth;
        state.changed = true;
        this.grid.setColumns(columns);
        this.restoreActiveHeader();
        this.grid.render();
    }

    private updateAutoScrollDirection(clientX: number): void {
        const viewport = this.getViewport();
        if (!viewport) {
            this.stopAutoScroll();
            return;
        }

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        if (clientX >= viewportWidth - this.options.edgeThresholdPx) {
            this.startAutoScroll(1);
        } else if (clientX <= this.options.edgeThresholdPx) {
            this.startAutoScroll(-1);
        } else {
            this.stopAutoScroll();
        }
    }

    private startAutoScroll(direction: -1 | 1): void {
        this.autoScrollDirection = direction;
        if (this.autoScrollTimer) {
            return;
        }

        this.autoScrollTimer = setInterval(() => {
            const state = this.resizeState;
            const viewport = this.getViewport();
            if (!state || !viewport || this.autoScrollDirection === 0) {
                return;
            }

            const previousScrollLeft = viewport.scrollLeft;
            viewport.scrollLeft += this.autoScrollDirection * this.options.scrollStepPx;
            const scrollDelta = viewport.scrollLeft - previousScrollLeft;
            if (scrollDelta === 0) {
                return;
            }

            state.autoScrollDeltaX += scrollDelta;
            this.applyResize();
        }, this.options.scrollIntervalMs);
    }

    private stopAutoScroll(): void {
        this.autoScrollDirection = 0;
        if (this.autoScrollTimer) {
            clearInterval(this.autoScrollTimer);
            this.autoScrollTimer = undefined;
        }
    }

    private stopResize(): void {
        const state = this.resizeState;
        this.stopAutoScroll();

        document.body.removeEventListener("pointermove", this.handlePointerMove);
        document.body.removeEventListener("pointerup", this.handlePointerUp);
        document.body.removeEventListener("pointercancel", this.handlePointerUp);
        document.body.removeEventListener("mousemove", this.handleMouseMove);
        document.body.removeEventListener("mouseup", this.handleMouseUp);

        if (state?.activeHandle) {
            state.activeHandle.removeEventListener("lostpointercapture", this.handlePointerUp);
            if (
                state.activePointerId !== undefined &&
                typeof state.activeHandle.hasPointerCapture === "function" &&
                state.activeHandle.hasPointerCapture(state.activePointerId) &&
                typeof state.activeHandle.releasePointerCapture === "function"
            ) {
                state.activeHandle.releasePointerCapture(state.activePointerId);
            }
        }

        state?.activeHeader.classList.remove("slick-header-column-active");
        this.resizeState = undefined;

        if (state?.changed) {
            this.grid.onColumnsResized.notify({ grid: this.grid });
        }
    }

    private getResizeHandle(target: EventTarget | null): HTMLElement | undefined {
        if (!(target instanceof Element)) {
            return undefined;
        }

        return (target.closest(".slick-resizable-handle") as HTMLElement | null) ?? undefined;
    }

    private getColumnFromHeader(header: HTMLElement): Slick.Column<T> | undefined {
        const columnId = header.id.replace(this.grid.getUID(), "");
        return this.grid.getColumns().find((column) => column.id === columnId);
    }

    private getViewport(): HTMLElement | undefined {
        return (
            this.grid.getContainerNode().querySelector<HTMLElement>(".slick-viewport") ?? undefined
        );
    }

    private restoreActiveHeader(): void {
        const state = this.resizeState;
        if (!state) {
            return;
        }

        const header = this.grid
            .getContainerNode()
            .querySelector<HTMLElement>(`#${this.grid.getUID()}${CSS.escape(state.columnId)}`);
        if (header) {
            header.classList.add("slick-header-column-active");
            state.activeHeader = header;
        }
    }

    private suppressLegacyResize(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
}
