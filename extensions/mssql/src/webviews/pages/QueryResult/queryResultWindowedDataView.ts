/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CustomDataView,
    ItemMetadata,
    OnSelectedRowIdsChangedEventArgs,
    OnRowCountChangedEventArgs,
    OnRowsChangedEventArgs,
    OnSetItemsCalledEventArgs,
    SlickEvent,
    SlickEventHandler,
    SlickGrid,
} from "@slickgrid-universal/common";
import { VirtualizedCollection } from "./table/asyncDataView";

function getRange(startIndex: number, count: number): number[] {
    return Array.from({ length: count }, (_value, index) => startIndex + index);
}

/**
 * Minimal custom data view used by the beta SlickGrid React result grid.
 *
 * It intentionally mirrors SlickGrid's small CustomDataView surface and keeps
 * windowing/fetching outside SlickGrid React's in-memory DataView. Sorting,
 * filtering, menus, and richer selection can be layered on this adapter without
 * forcing a later rewrite back to the legacy grid contracts.
 */
export class QueryResultWindowedDataView<T extends Slick.SlickData> implements CustomDataView<T> {
    public readonly onRowCountChanged = new SlickEvent<OnRowCountChangedEventArgs>(
        "onRowCountChanged",
    );
    public readonly onRowsChanged = new SlickEvent<OnRowsChangedEventArgs>("onRowsChanged");
    public readonly onSelectedRowIdsChanged = new SlickEvent<OnSelectedRowIdsChangedEventArgs>(
        "onSelectedRowIdsChanged",
    );
    public readonly onSetItemsCalled = new SlickEvent<OnSetItemsCalledEventArgs>(
        "onSetItemsCalled",
    );

    private grid: SlickGrid | undefined;
    private gridEventHandler = new SlickEventHandler();
    private disposed = false;
    private pendingAnimationFrame: number | undefined;

    constructor(private readonly collection: VirtualizedCollection<T>) {
        this.collection.setCollectionChangedCallback((startIndex, count) => {
            if (this.disposed) {
                return;
            }

            const rows = getRange(startIndex, count);
            this.onRowsChanged.notify({
                rows,
                itemCount: this.getLength(),
                dataView: this as any,
                calledOnRowCountChanged: false,
            });
            this.grid?.invalidateRows(rows);
            this.scheduleRender();
        });
    }

    public setGrid(grid: SlickGrid): void {
        this.gridEventHandler.unsubscribeAll();
        this.grid = grid;
        this.gridEventHandler.subscribe(grid.onViewportChanged, () => this.ensureViewportLoaded());
        this.gridEventHandler.subscribe(grid.onScroll, () => this.ensureViewportLoaded());
        this.ensureViewportLoaded();
    }

    public getItem(index: number): T {
        return this.collection.at(index);
    }

    public getItemMetadata(_row: number): ItemMetadata | null {
        return null;
    }

    public getLength(): number {
        return this.collection.getLength();
    }

    public getItemCount(): number {
        return this.getLength();
    }

    public getFilteredItemCount(): number {
        return this.getLength();
    }

    public getAllSelectedIds(): Array<string | number> {
        return [];
    }

    public getAllSelectedFilteredIds(): Array<string | number> {
        return [];
    }

    public getItems(): T[] {
        return [];
    }

    public setLength(length: number): void {
        const previous = this.getLength();
        if (previous === length) {
            return;
        }

        this.collection.setLength(length, false);
        this.onRowCountChanged.notify({
            previous,
            current: length,
            itemCount: length,
            dataView: this as any,
            callingOnRowsChanged: false,
        });
        this.scheduleRowCountUpdate();
        this.ensureViewportLoaded();
    }

    public refresh(startIndex = 0): void {
        this.collection.resetWindowsAroundIndex(startIndex);
        this.grid?.invalidateAllRows();
        this.grid?.updateRowCount();
        this.scheduleRender();
        this.ensureViewportLoaded();
    }

    public ensureViewportLoaded(): void {
        if (!this.grid || this.disposed) {
            return;
        }

        const viewport = this.grid.getViewport();
        const length = this.getLength();
        if (length <= 0) {
            return;
        }

        const start = Math.max(0, viewport.top);
        const end = Math.min(length, Math.max(start + 1, viewport.bottom + 1));
        this.collection.getRange(start, end);
    }

    private scheduleRowCountUpdate(): void {
        if (!this.grid || this.disposed) {
            return;
        }

        this.grid.updateRowCount();
        this.scheduleRender();
    }

    private scheduleRender(): void {
        if (!this.grid || this.disposed || this.pendingAnimationFrame !== undefined) {
            return;
        }

        this.pendingAnimationFrame = requestAnimationFrame(() => {
            this.pendingAnimationFrame = undefined;
            if (!this.disposed) {
                this.grid?.render();
            }
        });
    }

    public destroy(): void {
        this.dispose();
    }

    public dispose(): void {
        this.disposed = true;
        if (this.pendingAnimationFrame !== undefined) {
            cancelAnimationFrame(this.pendingAnimationFrame);
            this.pendingAnimationFrame = undefined;
        }
        this.gridEventHandler.unsubscribeAll();
        this.grid = undefined;
    }
}
