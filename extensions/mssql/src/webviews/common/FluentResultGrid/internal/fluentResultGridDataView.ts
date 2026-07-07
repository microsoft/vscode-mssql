/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CustomDataView,
    ItemMetadata,
    OnRowCountChangedEventArgs,
    OnRowsChangedEventArgs,
    OnSelectedRowIdsChangedEventArgs,
    OnSetItemsCalledEventArgs,
    SlickDataView,
    SlickEvent,
    SlickEventHandler,
    SlickGrid,
} from "@slickgrid-universal/common";
import type { DbCellValue } from "../../../../sharedInterfaces/queryResult";
import type {
    FluentResultGridDataSource,
    FluentResultGridRow,
} from "../types/fluentResultGridDataSource";
import type { MaybePromise } from "../types/fluentResultGridPrimitives";

export const FLUENT_RESULT_GRID_ROW_NUMBER_FIELD = "_fluentResultGridRowNumber";

export interface FluentResultGridCellValue extends DbCellValue {
    ariaLabel: string;
    invariantCultureDisplayValue: string;
}

export interface FluentResultGridDataRow extends Slick.SlickData {
    id: number;
    [FLUENT_RESULT_GRID_ROW_NUMBER_FIELD]: string;
    [key: string]: FluentResultGridCellValue | number | string;
}

export interface FluentResultGridRowStore<T extends Slick.SlickData> {
    readonly isFullyInMemory: boolean;
    getLength(): number;
    at(index: number): T;
    getRange(start: number, end: number): T[];
    getLoadedRange(start: number, end: number): T[];
    getRangeAsync(start: number, end: number): Promise<T[]>;
    setCollectionChangedCallback(callback: (startIndex: number, count: number) => void): void;
    setLength(length: number, resetData?: boolean): void;
    setRows?: (rows: FluentResultGridRow[], length?: number) => number;
    resetAroundIndex?: (index: number) => void;
    getItems(): T[];
    dispose(): void;
}

export interface FluentResultGridRowFactory<T extends Slick.SlickData> {
    createRow: (cells: FluentResultGridRow, absoluteRowIndex: number, columnCount: number) => T;
    createPlaceholderRow: (absoluteRowIndex: number, columnCount: number) => T;
}

export interface FluentResultGridDataViewOptions<T extends Slick.SlickData> {
    dataSource: FluentResultGridDataSource;
    columnCount: number;
    windowSize?: number;
    rowFactory?: FluentResultGridRowFactory<T>;
}

interface Range {
    start: number;
    end: number;
}

const defaultWindowSize = 50;

function toInteger(value: number): number {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

function toNonNegativeInteger(value: number): number {
    return Math.max(0, toInteger(value));
}

function toPositiveInteger(value: number, fallback: number): number {
    const integer = toInteger(value);
    return integer > 0 ? integer : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function getRange(startIndex: number, count: number): number[] {
    return Array.from({ length: count }, (_value, index) => startIndex + index);
}

function createDefaultCellValue(cell: DbCellValue | undefined, absoluteRowIndex: number) {
    const displayValue = cell?.isNull ? "NULL" : (cell?.displayValue ?? "");

    return {
        displayValue,
        ariaLabel: displayValue,
        isNull: cell?.isNull ?? false,
        invariantCultureDisplayValue: displayValue,
        // Preserve a source-supplied row id (SOURCE row space) so consumers
        // can resolve the original row after sort/filter reorders display
        // rows; fall back to the absolute display index.
        rowId: cell?.rowId ?? absoluteRowIndex,
    } satisfies FluentResultGridCellValue;
}

export function createFluentResultGridDataRow(
    cells: FluentResultGridRow,
    absoluteRowIndex: number,
    columnCount: number,
): FluentResultGridDataRow {
    const row: FluentResultGridDataRow = {
        id: absoluteRowIndex,
        [FLUENT_RESULT_GRID_ROW_NUMBER_FIELD]: (absoluteRowIndex + 1).toString(),
    };

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        row[columnIndex.toString()] = createDefaultCellValue(cells[columnIndex], absoluteRowIndex);
    }

    return row;
}

export function createFluentResultGridPlaceholderRow(
    absoluteRowIndex: number,
    columnCount: number,
): FluentResultGridDataRow {
    return createFluentResultGridDataRow([], absoluteRowIndex, columnCount);
}

function getDefaultRowFactory<T extends Slick.SlickData>(): FluentResultGridRowFactory<T> {
    return {
        createRow:
            createFluentResultGridDataRow as unknown as FluentResultGridRowFactory<T>["createRow"],
        createPlaceholderRow:
            createFluentResultGridPlaceholderRow as unknown as FluentResultGridRowFactory<T>["createPlaceholderRow"],
    };
}

class FluentResultGridInMemoryRowStore<T extends Slick.SlickData>
    implements FluentResultGridRowStore<T>
{
    public readonly isFullyInMemory = true;
    private collectionChangedCallback?: (startIndex: number, count: number) => void;

    constructor(
        rows: FluentResultGridRow[],
        private readonly columnCount: number,
        private length: number,
        private readonly rowFactory: FluentResultGridRowFactory<T>,
    ) {
        this.rows = rows.map((row, index) => this.rowFactory.createRow(row, index, columnCount));
        this.length = toNonNegativeInteger(length);
    }

    private rows: T[];

    public getLength(): number {
        return this.length;
    }

    public at(index: number): T {
        const normalizedIndex = toInteger(index);
        if (normalizedIndex < 0 || normalizedIndex >= this.length) {
            return this.rowFactory.createPlaceholderRow(normalizedIndex, this.columnCount);
        }

        return (
            this.rows[normalizedIndex] ??
            this.rowFactory.createPlaceholderRow(normalizedIndex, this.columnCount)
        );
    }

    public getRange(start: number, end: number): T[] {
        const range = normalizeRange(start, end, this.length);
        const rows: T[] = [];

        for (let index = range.start; index < range.end; index++) {
            rows.push(this.at(index));
        }

        return rows;
    }

    public getRangeAsync(start: number, end: number): Promise<T[]> {
        return Promise.resolve(this.getRange(start, end));
    }

    public getLoadedRange(start: number, end: number): T[] {
        return this.getRange(start, end);
    }

    public setCollectionChangedCallback(
        callback: (startIndex: number, count: number) => void,
    ): void {
        this.collectionChangedCallback = callback;
    }

    public setLength(length: number): void {
        const nextLength = toNonNegativeInteger(length);
        if (nextLength === this.length) {
            return;
        }

        const changedStart = Math.min(nextLength, this.length);
        const changedCount = Math.abs(nextLength - this.length);
        this.length = nextLength;
        this.collectionChangedCallback?.(changedStart, changedCount);
    }

    public setRows(rows: FluentResultGridRow[], length = rows.length): number {
        this.rows = rows.map((row, index) =>
            this.rowFactory.createRow(row, index, this.columnCount),
        );
        this.length = toNonNegativeInteger(length);
        return this.length;
    }

    public getItems(): T[] {
        return this.getRange(0, this.length);
    }

    public dispose(): void {
        this.collectionChangedCallback = undefined;
        this.rows = [];
    }
}

class FluentResultGridDataWindow<T extends Slick.SlickData> {
    private rows: T[] | undefined;
    private length = 0;
    private offset = -1;
    private requestId = 0;

    constructor(
        private readonly loadRows: (offset: number, count: number) => MaybePromise<T[]>,
        private readonly createPlaceholderRow: (index: number) => T,
        private readonly loadCompleteCallback: (start: number, end: number) => void,
    ) {}

    public getStartIndex(): number {
        return this.offset;
    }

    public getEndIndex(): number {
        return this.offset + this.length;
    }

    public contains(index: number): boolean {
        return index >= this.getStartIndex() && index < this.getEndIndex();
    }

    public getItem(index: number): T {
        return this.rows?.[index - this.offset] ?? this.createPlaceholderRow(index);
    }

    public getLoadedItem(index: number): T | undefined {
        if (!this.rows || !this.contains(index)) {
            return undefined;
        }

        return this.rows[index - this.offset];
    }

    public positionWindow(offset: number, length: number, totalItems: number): void {
        const totalLength = toNonNegativeInteger(totalItems);
        const nextOffset = clamp(toNonNegativeInteger(offset), 0, totalLength);
        const nextLength = clamp(toNonNegativeInteger(length), 0, totalLength - nextOffset);

        this.offset = nextOffset;
        this.length = nextLength;
        this.rows = undefined;

        const currentRequestId = ++this.requestId;
        if (nextLength === 0) {
            return;
        }

        Promise.resolve(this.loadRows(nextOffset, nextLength)).then(
            (rows) => {
                if (currentRequestId !== this.requestId || !Array.isArray(rows)) {
                    return;
                }

                this.rows = rows;
                this.loadCompleteCallback(this.offset, this.offset + this.length);
            },
            () => undefined,
        );
    }

    public dispose(): void {
        this.rows = undefined;
        this.length = 0;
        this.offset = -1;
        this.requestId++;
    }
}

class FluentResultGridWindowedRowStore<T extends Slick.SlickData>
    implements FluentResultGridRowStore<T>
{
    public readonly isFullyInMemory = false;
    private readonly windowSize: number;
    private bufferWindowBefore: FluentResultGridDataWindow<T>;
    private window: FluentResultGridDataWindow<T>;
    private bufferWindowAfter: FluentResultGridDataWindow<T>;
    private lengthChanged = true;
    private disposed = false;
    private collectionChangedCallback?: (startIndex: number, count: number) => void;

    constructor(
        windowSize: number,
        private readonly createPlaceholderRow: (index: number) => T,
        private length: number,
        private readonly loadRows: (offset: number, count: number) => MaybePromise<T[]>,
    ) {
        this.windowSize = toPositiveInteger(windowSize, 1);

        const loadCompleteCallback = (start: number, end: number) => {
            if (!this.disposed) {
                this.collectionChangedCallback?.(start, end - start);
            }
        };

        this.bufferWindowBefore = this.createDataWindow(loadCompleteCallback);
        this.window = this.createDataWindow(loadCompleteCallback);
        this.bufferWindowAfter = this.createDataWindow(loadCompleteCallback);
        this.length = toNonNegativeInteger(length);
    }

    private createDataWindow(
        loadCompleteCallback: (start: number, end: number) => void,
    ): FluentResultGridDataWindow<T> {
        return new FluentResultGridDataWindow(
            this.loadRows,
            this.createPlaceholderRow,
            loadCompleteCallback,
        );
    }

    public getLength(): number {
        return this.length;
    }

    public setCollectionChangedCallback(
        callback: (startIndex: number, count: number) => void,
    ): void {
        this.collectionChangedCallback = callback;
    }

    public setLength(length: number, resetData = true): void {
        const nextLength = toNonNegativeInteger(length);
        const shouldResetWindows = resetData || nextLength < this.length;
        this.lengthChanged = this.lengthChanged || shouldResetWindows;
        this.length = nextLength;
    }

    public at(index: number): T {
        const normalizedIndex = toInteger(index);

        if (normalizedIndex < 0 || normalizedIndex >= this.length) {
            return this.createPlaceholderRow(normalizedIndex);
        }

        return this.getRange(normalizedIndex, normalizedIndex + 1)[0];
    }

    public getRange(start: number, end: number): T[] {
        const range = normalizeRange(start, end, this.length);

        if (range.end <= range.start) {
            return [];
        }

        const currentRows = this.getRangeFromCurrentWindows(range.start, range.end);

        if (
            this.lengthChanged ||
            range.start < this.bufferWindowBefore.getStartIndex() ||
            range.end > this.bufferWindowAfter.getEndIndex()
        ) {
            this.lengthChanged = false;
            this.resetAroundIndex(range.start);
        } else if (range.end <= this.bufferWindowBefore.getEndIndex()) {
            const recycledWindow = this.bufferWindowAfter;
            this.bufferWindowAfter = this.window;
            this.window = this.bufferWindowBefore;
            this.bufferWindowBefore = recycledWindow;

            const windowOffset = Math.max(0, this.window.getStartIndex() - this.windowSize);
            this.bufferWindowBefore.positionWindow(
                windowOffset,
                this.window.getStartIndex() - windowOffset,
                this.length,
            );
        } else if (range.start >= this.bufferWindowAfter.getStartIndex()) {
            const recycledWindow = this.bufferWindowBefore;
            this.bufferWindowBefore = this.window;
            this.window = this.bufferWindowAfter;
            this.bufferWindowAfter = recycledWindow;

            const windowOffset = Math.min(
                this.window.getStartIndex() + this.windowSize,
                this.length,
            );
            this.bufferWindowAfter.positionWindow(
                windowOffset,
                Math.min(this.length - windowOffset, this.windowSize),
                this.length,
            );
        }

        return currentRows;
    }

    public getLoadedRange(start: number, end: number): T[] {
        const range = normalizeRange(start, end, this.length);

        if (range.end <= range.start) {
            return [];
        }

        return this.getPartialLoadedRangeFromCurrentWindows(range.start, range.end);
    }

    public async getRangeAsync(start: number, end: number): Promise<T[]> {
        const range = normalizeRange(start, end, this.length);

        if (range.end <= range.start) {
            return [];
        }

        const loadedRows = this.getLoadedRangeFromCurrentWindows(range.start, range.end);
        if (loadedRows) {
            return loadedRows;
        }

        const rows = await Promise.resolve(
            this.loadRows(range.start, range.end - range.start),
        ).catch(() => []);
        return Array.from(
            { length: range.end - range.start },
            (_value, index) => rows[index] ?? this.createPlaceholderRow(range.start + index),
        );
    }

    public resetAroundIndex(index: number): void {
        const targetIndex = clamp(toNonNegativeInteger(index), 0, this.length);
        const beforeStart = Math.max(0, targetIndex - this.windowSize * 1.5);
        const beforeEnd = Math.max(0, targetIndex - this.windowSize / 2);
        this.bufferWindowBefore.positionWindow(beforeStart, beforeEnd - beforeStart, this.length);

        const windowStart = beforeEnd;
        const windowEnd = Math.min(windowStart + this.windowSize, this.length);
        this.window.positionWindow(windowStart, windowEnd - windowStart, this.length);

        const afterStart = windowEnd;
        const afterEnd = Math.min(afterStart + this.windowSize, this.length);
        this.bufferWindowAfter.positionWindow(afterStart, afterEnd - afterStart, this.length);
    }

    public getItems(): T[] {
        return [];
    }

    public dispose(): void {
        this.disposed = true;
        this.collectionChangedCallback = undefined;
        this.bufferWindowBefore.dispose();
        this.window.dispose();
        this.bufferWindowAfter.dispose();
    }

    private getLoadedRangeFromCurrentWindows(start: number, end: number): T[] | undefined {
        const rows: T[] = [];
        for (let index = start; index < end; index++) {
            const row = this.getLoadedDataFromCurrentWindows(index);
            if (!row) {
                return undefined;
            }

            rows.push(row);
        }

        return rows;
    }

    private getPartialLoadedRangeFromCurrentWindows(start: number, end: number): T[] {
        const rows: T[] = [];
        for (let index = start; index < end; index++) {
            const row = this.getLoadedDataFromCurrentWindows(index);
            if (row) {
                rows.push(row);
            }
        }

        return rows;
    }

    private getRangeFromCurrentWindows(start: number, end: number): T[] {
        const rows: T[] = [];
        for (let index = start; index < end; index++) {
            rows.push(this.getDataFromCurrentWindows(index));
        }
        return rows;
    }

    private getLoadedDataFromCurrentWindows(index: number): T | undefined {
        return (
            this.bufferWindowBefore.getLoadedItem(index) ??
            this.bufferWindowAfter.getLoadedItem(index) ??
            this.window.getLoadedItem(index)
        );
    }

    private getDataFromCurrentWindows(index: number): T {
        if (this.bufferWindowBefore.contains(index)) {
            return this.bufferWindowBefore.getItem(index);
        }

        if (this.bufferWindowAfter.contains(index)) {
            return this.bufferWindowAfter.getItem(index);
        }

        if (this.window.contains(index)) {
            return this.window.getItem(index);
        }

        return this.createPlaceholderRow(index);
    }
}

export class FluentResultGridDataView<T extends Slick.SlickData> implements CustomDataView<T> {
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

    constructor(private readonly rowStore: FluentResultGridRowStore<T>) {
        this.rowStore.setCollectionChangedCallback((startIndex, count) => {
            if (this.disposed) {
                return;
            }

            const rows = getRange(startIndex, count);
            this.onRowsChanged.notify({
                rows,
                itemCount: this.getLength(),
                dataView: this as unknown as SlickDataView,
                calledOnRowCountChanged: false,
            });
            this.grid?.invalidateRows(rows);
            this.scheduleRender();
        });
    }

    public get isFullyInMemory(): boolean {
        return this.rowStore.isFullyInMemory;
    }

    public setGrid(grid: SlickGrid): void {
        this.gridEventHandler.unsubscribeAll();
        this.grid = grid;
        this.gridEventHandler.subscribe(grid.onViewportChanged, () => this.ensureViewportLoaded());
        this.gridEventHandler.subscribe(grid.onScroll, () => this.ensureViewportLoaded());
        this.ensureViewportLoaded();
        requestAnimationFrame(() => this.ensureViewportLoaded());
    }

    public getItem(index: number): T {
        return this.rowStore.at(index);
    }

    public getItemMetadata(_row: number): ItemMetadata | null {
        return null;
    }

    public getLength(): number {
        return this.rowStore.getLength();
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
        return this.rowStore.getItems();
    }

    public getRangeAsync(startIndex: number, length: number): Promise<T[]> {
        const start = toNonNegativeInteger(startIndex);
        return this.rowStore.getRangeAsync(start, start + toNonNegativeInteger(length));
    }

    public getLoadedRange(startIndex: number, length: number): T[] {
        const start = toNonNegativeInteger(startIndex);
        return this.rowStore.getLoadedRange(start, start + toNonNegativeInteger(length));
    }

    public setLength(length: number, resetData = false): void {
        const previous = this.getLength();
        const nextLength = toNonNegativeInteger(length);
        if (previous === nextLength && !resetData) {
            return;
        }

        this.rowStore.setLength(nextLength, resetData);
        if (previous !== nextLength) {
            this.onRowCountChanged.notify({
                previous,
                current: nextLength,
                itemCount: nextLength,
                dataView: this as unknown as SlickDataView,
                callingOnRowsChanged: false,
            });
            this.scheduleRowCountUpdate();
        } else {
            this.grid?.invalidateAllRows();
            this.scheduleRender();
        }

        this.ensureViewportLoaded();
    }

    public setRows(rows: FluentResultGridRow[], length = rows.length): boolean {
        const previous = this.getLength();
        const nextLength = this.rowStore.setRows?.(rows, length);
        if (nextLength === undefined) {
            return false;
        }

        if (previous !== nextLength) {
            this.onRowCountChanged.notify({
                previous,
                current: nextLength,
                itemCount: nextLength,
                dataView: this as unknown as SlickDataView,
                callingOnRowsChanged: false,
            });
            this.scheduleRowCountUpdate();
        }

        if (nextLength > 0) {
            this.onRowsChanged.notify({
                rows: getRange(0, nextLength),
                itemCount: nextLength,
                dataView: this as unknown as SlickDataView,
                calledOnRowCountChanged: previous !== nextLength,
            });
        }
        this.grid?.invalidateAllRows();
        this.scheduleRender();
        this.ensureViewportLoaded();
        return true;
    }

    public refresh(startIndex = 0): void {
        this.rowStore.resetAroundIndex?.(toNonNegativeInteger(startIndex));

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
        this.rowStore.getRange(start, end);
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
        this.rowStore.dispose();
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
}

export function createFluentResultGridDataView<T extends Slick.SlickData = FluentResultGridDataRow>(
    options: FluentResultGridDataViewOptions<T>,
): FluentResultGridDataView<T> {
    const rowFactory = options.rowFactory ?? getDefaultRowFactory<T>();
    const columnCount = toNonNegativeInteger(options.columnCount);

    const { dataSource } = options;

    if (dataSource.kind === "rows") {
        return new FluentResultGridDataView(
            new FluentResultGridInMemoryRowStore(
                dataSource.rows,
                columnCount,
                dataSource.rowCount ?? dataSource.rows.length,
                rowFactory,
            ),
        );
    }

    return new FluentResultGridDataView(
        new FluentResultGridWindowedRowStore(
            options.windowSize ?? defaultWindowSize,
            (index) => rowFactory.createPlaceholderRow(index, columnCount),
            dataSource.rowCount,
            async (offset, count) => {
                const rows = await dataSource.getRows(offset, count);
                return rows.map((row, rowOffset) =>
                    rowFactory.createRow(row, offset + rowOffset, columnCount),
                );
            },
        ),
    );
}

function normalizeRange(start: number, end: number, length: number): Range {
    const normalizedLength = toNonNegativeInteger(length);
    const normalizedStart = clamp(toNonNegativeInteger(start), 0, normalizedLength);
    const normalizedEnd = clamp(toNonNegativeInteger(end), normalizedStart, normalizedLength);
    return { start: normalizedStart, end: normalizedEnd };
}
