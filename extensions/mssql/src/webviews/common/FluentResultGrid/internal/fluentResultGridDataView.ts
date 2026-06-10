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
    getRangeAsync(start: number, end: number): Promise<T[]>;
    setCollectionChangedCallback(callback: (startIndex: number, count: number) => void): void;
    setLength(length: number, resetData?: boolean): void;
    resetAroundIndex?: (index: number) => void;
    getItems(): T[];
    dispose(): void;
}

export interface FluentResultGridRowFactory<T extends Slick.SlickData> {
    createRow: (cells: FluentResultGridRow, absoluteRowIndex: number, columnCount: number) => T;
    createPlaceholderRow: (absoluteRowIndex: number, columnCount: number) => T;
}

export interface FluentResultGridWindowedRowStoreOptions {
    /**
     * Hard per-grid row-cache budget, expressed in pages. A page is `windowSize` rows.
     *
     * Default is 3: one visible page plus adjacent pages around it.
     */
    maxCachedPages?: number;

    /**
     * Pages to keep around the viewport when scroll direction is unknown.
     */
    basePrefetchPages?: number;

    /**
     * Extra pages to bias in the current scroll direction.
     */
    directionalPrefetchPages?: number;

    /**
     * Bounds background prefetch concurrency per grid. Visible range requests are not blocked by
     * this value.
     */
    maxPendingPrefetchRequests?: number;

    /**
     * Maximum rows requested in one visible-priority load.
     */
    visibleLoadChunkSize?: number;

    /**
     * Maximum rows requested in one background prefetch load.
     */
    prefetchLoadChunkSize?: number;
}

export interface FluentResultGridDataViewOptions<T extends Slick.SlickData> {
    dataSource: FluentResultGridDataSource;
    columnCount: number;
    windowSize?: number;
    rowFactory?: FluentResultGridRowFactory<T>;
    windowedStoreOptions?: FluentResultGridWindowedRowStoreOptions;
}

interface Range {
    start: number;
    end: number;
}

interface PendingRequest extends Range {
    generation: number;
    priority: boolean;
    completion: Promise<void>;
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

function rangesOverlap(left: Range, right: Range): boolean {
    return left.start < right.end && right.start < left.end;
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
        rowId: absoluteRowIndex,
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

    public getItems(): T[] {
        return this.getRange(0, this.length);
    }

    public dispose(): void {
        this.collectionChangedCallback = undefined;
        this.rows = [];
    }
}

class FluentResultGridWindowedRowStore<T extends Slick.SlickData>
    implements FluentResultGridRowStore<T>
{
    private static readonly defaultMaxCachedPages = 3;
    private static readonly defaultBasePrefetchPages = 1;
    private static readonly defaultDirectionalPrefetchPages = 1;
    private static readonly defaultMaxPendingPrefetchRequests = 2;

    public readonly isFullyInMemory = false;
    private readonly pageSize: number;
    private readonly maxCachedPages: number;
    private readonly maxCachedRows: number;
    private readonly basePrefetchPages: number;
    private readonly directionalPrefetchPages: number;
    private readonly maxPendingPrefetchRequests: number;
    private readonly visibleLoadChunkSize: number;
    private readonly prefetchLoadChunkSize: number;

    private cache = new Map<number, T>();
    private placeholderCache = new Map<number, T>();
    private pendingRequests = new Map<string, PendingRequest>();
    private pendingChangedRanges: Range[] = [];

    private generation = 0;
    private disposed = false;
    private lastVisibleRange: Range = { start: 0, end: 0 };
    private lastScrollStart: number | undefined;
    private scrollDirection: -1 | 0 | 1 = 0;
    private collectionChangedTimer: ReturnType<typeof setTimeout> | undefined;
    private collectionChangedCallback?: (startIndex: number, count: number) => void;

    constructor(
        windowSize: number,
        private readonly createPlaceholderRow: (index: number) => T,
        private length: number,
        private readonly loadRows: (offset: number, count: number) => MaybePromise<T[]>,
        options: FluentResultGridWindowedRowStoreOptions = {},
    ) {
        this.pageSize = toPositiveInteger(windowSize, 1);
        this.length = toNonNegativeInteger(length);
        this.maxCachedPages = toPositiveInteger(
            options.maxCachedPages ?? FluentResultGridWindowedRowStore.defaultMaxCachedPages,
            FluentResultGridWindowedRowStore.defaultMaxCachedPages,
        );
        this.maxCachedRows = this.pageSize * this.maxCachedPages;
        this.basePrefetchPages = toNonNegativeInteger(
            options.basePrefetchPages ?? FluentResultGridWindowedRowStore.defaultBasePrefetchPages,
        );
        this.directionalPrefetchPages = toNonNegativeInteger(
            options.directionalPrefetchPages ??
                FluentResultGridWindowedRowStore.defaultDirectionalPrefetchPages,
        );
        this.maxPendingPrefetchRequests = toPositiveInteger(
            options.maxPendingPrefetchRequests ??
                FluentResultGridWindowedRowStore.defaultMaxPendingPrefetchRequests,
            FluentResultGridWindowedRowStore.defaultMaxPendingPrefetchRequests,
        );
        this.visibleLoadChunkSize = toPositiveInteger(
            options.visibleLoadChunkSize ?? this.pageSize,
            this.pageSize,
        );
        this.prefetchLoadChunkSize = toPositiveInteger(
            options.prefetchLoadChunkSize ?? this.pageSize,
            this.pageSize,
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
        const previousLength = this.length;
        const lengthChanged = nextLength !== previousLength;

        this.length = nextLength;

        if (resetData || nextLength < previousLength) {
            this.invalidateCachedData(true);
            return;
        }

        if (lengthChanged) {
            this.removeCachedRowsAtOrAfter(nextLength);
            this.removePendingRequestsOutsideLength();
            this.trimCache();
        }
    }

    public at(index: number): T {
        const normalizedIndex = toInteger(index);

        if (normalizedIndex < 0 || normalizedIndex >= this.length) {
            return this.createPlaceholderRow(normalizedIndex);
        }

        return (
            this.getRange(normalizedIndex, normalizedIndex + 1)[0] ??
            this.createPlaceholderRow(normalizedIndex)
        );
    }

    public getRange(start: number, end: number): T[] {
        const range = normalizeRange(start, end, this.length);

        if (range.end <= range.start) {
            return [];
        }

        void this.onRangeRequested(range);
        return this.readRangeFromCache(range);
    }

    public async getRangeAsync(start: number, end: number): Promise<T[]> {
        const range = normalizeRange(start, end, this.length);

        if (range.end <= range.start) {
            return [];
        }

        const visibleLoads = this.onRangeRequested(range);
        if (visibleLoads.length > 0) {
            await Promise.all(visibleLoads.map((load) => load.catch(() => undefined)));
        }

        return this.readRangeFromCache(range);
    }

    public resetAroundIndex(index: number): void {
        const start = clamp(toNonNegativeInteger(index), 0, this.length);
        const end = Math.min(start + this.pageSize, this.length);

        if (end <= start) {
            this.trimCache();
            return;
        }

        void this.onRangeRequested({ start, end });
    }

    public getItems(): T[] {
        return [];
    }

    public dispose(): void {
        this.disposed = true;
        this.generation++;
        this.cache.clear();
        this.placeholderCache.clear();
        this.pendingRequests.clear();
        this.pendingChangedRanges = [];
        this.collectionChangedCallback = undefined;

        if (this.collectionChangedTimer !== undefined) {
            clearTimeout(this.collectionChangedTimer);
            this.collectionChangedTimer = undefined;
        }
    }

    private onRangeRequested(range: Range): Promise<void>[] {
        this.lastVisibleRange = range;
        this.updateScrollDirection(range.start);
        this.trimPendingRequests();

        const visibleLoads = this.ensureRange(range.start, range.end, true);
        this.prefetchAroundVisibleRange();
        this.trimCache();

        return visibleLoads;
    }

    private readRangeFromCache(range: Range): T[] {
        const rows = new Array<T>(range.end - range.start);
        for (let index = range.start; index < range.end; index++) {
            rows[index - range.start] = this.getCachedRow(index) ?? this.getPlaceholderRow(index);
        }

        this.trimCache();
        return rows;
    }

    private updateScrollDirection(start: number): void {
        if (this.lastScrollStart === undefined) {
            this.lastScrollStart = start;
            return;
        }

        if (start > this.lastScrollStart) {
            this.scrollDirection = 1;
        } else if (start < this.lastScrollStart) {
            this.scrollDirection = -1;
        } else {
            this.scrollDirection = 0;
        }

        this.lastScrollStart = start;
    }

    private prefetchAroundVisibleRange(): void {
        const desiredRange = this.getDesiredCacheRange();
        const visibleRange = normalizeRange(
            this.lastVisibleRange.start,
            this.lastVisibleRange.end,
            this.length,
        );

        if (desiredRange.end <= desiredRange.start || visibleRange.end <= visibleRange.start) {
            return;
        }

        if (desiredRange.start < visibleRange.start) {
            void this.ensureRange(desiredRange.start, visibleRange.start, false);
        }

        if (visibleRange.end < desiredRange.end) {
            void this.ensureRange(visibleRange.end, desiredRange.end, false);
        }
    }

    private ensureRange(start: number, end: number, priority: boolean): Promise<void>[] {
        if (this.disposed || this.length <= 0 || end <= start) {
            return [];
        }

        const range = normalizeRange(start, end, this.length);
        if (range.end <= range.start) {
            return [];
        }

        const chunkSize = priority ? this.visibleLoadChunkSize : this.prefetchLoadChunkSize;
        return this.ensureMissingSegments(range.start, range.end, priority, chunkSize);
    }

    private ensureMissingSegments(
        start: number,
        end: number,
        priority: boolean,
        chunkSize: number,
    ): Promise<void>[] {
        const loads: Promise<void>[] = [];
        const seenPendingLoads = new Set<Promise<void>>();
        let index = start;

        while (index < end) {
            if (this.cache.has(index)) {
                index++;
                continue;
            }

            const pending = this.getPendingRequestCoveringIndex(index);
            if (pending) {
                if (priority) {
                    pending.priority = true;
                    if (!seenPendingLoads.has(pending.completion)) {
                        seenPendingLoads.add(pending.completion);
                        loads.push(pending.completion);
                    }
                }
                index = Math.max(index + 1, Math.min(pending.end, end));
                continue;
            }

            const segmentStart = index;
            const segmentLimit = Math.min(end, segmentStart + chunkSize);
            index++;

            while (
                index < segmentLimit &&
                !this.cache.has(index) &&
                !this.getPendingRequestCoveringIndex(index)
            ) {
                index++;
            }

            const load = this.requestRangeIfNeeded(segmentStart, index, priority);
            if (load) {
                loads.push(load);
            }
        }

        return loads;
    }

    private requestRangeIfNeeded(
        start: number,
        end: number,
        priority: boolean,
    ): Promise<void> | undefined {
        if (!priority && this.getPendingPrefetchRequestCount() >= this.maxPendingPrefetchRequests) {
            return undefined;
        }

        if (!priority && !rangesOverlap({ start, end }, this.getDesiredCacheRange())) {
            return undefined;
        }

        if (this.hasEveryRow(start, end)) {
            return undefined;
        }

        const key = this.getRequestKey(start, end);
        const pendingRequest = this.pendingRequests.get(key);
        if (pendingRequest?.generation === this.generation) {
            pendingRequest.priority = pendingRequest.priority || priority;
            return pendingRequest.completion;
        }

        const request: PendingRequest = {
            start,
            end,
            generation: this.generation,
            priority,
            completion: Promise.resolve(),
        };

        this.pendingRequests.set(key, request);

        let promise: Promise<T[]>;
        try {
            promise = Promise.resolve(this.loadRows(start, end - start));
        } catch {
            this.pendingRequests.delete(key);
            return Promise.resolve();
        }

        request.completion = promise.then(
            (rows) => this.completeRowLoad(key, request, rows),
            () => this.failRowLoad(key, request),
        );

        return request.completion;
    }

    private completeRowLoad(key: string, request: PendingRequest, rows: T[]): void {
        const pendingRequest = this.pendingRequests.get(key);
        if (
            this.disposed ||
            pendingRequest !== request ||
            request.generation !== this.generation ||
            !Array.isArray(rows)
        ) {
            return;
        }

        this.pendingRequests.delete(key);

        if (!request.priority && !rangesOverlap(request, this.getDesiredCacheRange())) {
            return;
        }

        const maxRowsToApply = Math.min(
            rows.length,
            request.end - request.start,
            this.length - request.start,
        );
        if (maxRowsToApply <= 0) {
            return;
        }

        let changedStart = Number.POSITIVE_INFINITY;
        let changedEnd = Number.NEGATIVE_INFINITY;

        for (let offset = 0; offset < maxRowsToApply; offset++) {
            const rowIndex = request.start + offset;
            if (rowIndex < 0 || rowIndex >= this.length) {
                continue;
            }

            this.cache.set(rowIndex, rows[offset]);
            this.placeholderCache.delete(rowIndex);
            changedStart = Math.min(changedStart, rowIndex);
            changedEnd = Math.max(changedEnd, rowIndex + 1);
        }

        this.trimCache();

        if (changedEnd > changedStart) {
            this.queueCollectionChanged(changedStart, changedEnd);
        }
    }

    private failRowLoad(key: string, request: PendingRequest): void {
        if (this.pendingRequests.get(key) === request) {
            this.pendingRequests.delete(key);
        }
    }

    private getDesiredCacheRange(): Range {
        const visibleRange = normalizeRange(
            this.lastVisibleRange.start,
            this.lastVisibleRange.end,
            this.length,
        );
        if (visibleRange.end <= visibleRange.start || this.length <= 0) {
            return { start: 0, end: 0 };
        }

        const visiblePageStart = this.getPageStart(visibleRange.start);
        const lastVisibleIndex = Math.max(visibleRange.start, visibleRange.end - 1);
        const visiblePageEnd = Math.min(
            this.length,
            this.getPageStart(lastVisibleIndex) + this.pageSize,
        );
        const visiblePages = Math.max(
            1,
            Math.ceil((visiblePageEnd - visiblePageStart) / this.pageSize),
        );
        const extraPageBudget = Math.max(0, this.maxCachedPages - visiblePages);

        let beforePages = 0;
        let afterPages = 0;

        if (this.scrollDirection > 0) {
            afterPages = Math.min(
                extraPageBudget,
                this.basePrefetchPages + this.directionalPrefetchPages,
            );
            beforePages = Math.min(extraPageBudget - afterPages, this.basePrefetchPages);
        } else if (this.scrollDirection < 0) {
            beforePages = Math.min(
                extraPageBudget,
                this.basePrefetchPages + this.directionalPrefetchPages,
            );
            afterPages = Math.min(extraPageBudget - beforePages, this.basePrefetchPages);
        } else {
            beforePages = Math.min(extraPageBudget, this.basePrefetchPages);
            afterPages = Math.min(extraPageBudget - beforePages, this.basePrefetchPages);
        }

        return {
            start: Math.max(0, visiblePageStart - beforePages * this.pageSize),
            end: Math.min(this.length, visiblePageEnd + afterPages * this.pageSize),
        };
    }

    private getCacheBudgetRows(): number {
        const visibleCount = Math.max(0, this.lastVisibleRange.end - this.lastVisibleRange.start);
        return Math.max(this.maxCachedRows, visibleCount);
    }

    private getPageStart(index: number): number {
        return Math.floor(index / this.pageSize) * this.pageSize;
    }

    private getRequestKey(start: number, end: number): string {
        return `${start}:${end}`;
    }

    private getPendingRequestCoveringIndex(index: number): PendingRequest | undefined {
        for (const request of this.pendingRequests.values()) {
            if (
                request.generation === this.generation &&
                index >= request.start &&
                index < request.end
            ) {
                return request;
            }
        }

        return undefined;
    }

    private getPendingPrefetchRequestCount(): number {
        let count = 0;
        for (const request of this.pendingRequests.values()) {
            if (!request.priority) {
                count++;
            }
        }
        return count;
    }

    private trimPendingRequests(): void {
        const desiredRange = this.getDesiredCacheRange();
        for (const [key, request] of this.pendingRequests) {
            if (request.generation !== this.generation || !rangesOverlap(request, desiredRange)) {
                this.pendingRequests.delete(key);
            }
        }
    }

    private hasEveryRow(start: number, end: number): boolean {
        for (let index = start; index < end; index++) {
            if (!this.cache.has(index)) {
                return false;
            }
        }
        return true;
    }

    private getCachedRow(index: number): T | undefined {
        if (!this.cache.has(index)) {
            return undefined;
        }

        const row = this.cache.get(index)!;
        this.cache.delete(index);
        this.cache.set(index, row);

        return row;
    }

    private getPlaceholderRow(index: number): T {
        const cachedPlaceholder = this.placeholderCache.get(index);
        if (cachedPlaceholder !== undefined) {
            return cachedPlaceholder;
        }

        const placeholder = this.createPlaceholderRow(index);
        this.placeholderCache.set(index, placeholder);
        return placeholder;
    }

    private trimCache(): void {
        const desiredRange = this.getDesiredCacheRange();
        if (desiredRange.end <= desiredRange.start) {
            this.placeholderCache.clear();
            while (this.cache.size > this.maxCachedRows) {
                const oldestRowIndex = this.cache.keys().next().value as number | undefined;
                if (oldestRowIndex === undefined) {
                    break;
                }
                this.cache.delete(oldestRowIndex);
            }
            return;
        }

        for (const index of this.cache.keys()) {
            if (index < desiredRange.start || index >= desiredRange.end) {
                this.cache.delete(index);
            }
        }

        for (const index of this.placeholderCache.keys()) {
            if (index < desiredRange.start || index >= desiredRange.end || this.cache.has(index)) {
                this.placeholderCache.delete(index);
            }
        }

        const budgetRows = this.getCacheBudgetRows();
        if (this.cache.size <= budgetRows) {
            return;
        }

        const visibleRange = normalizeRange(
            this.lastVisibleRange.start,
            this.lastVisibleRange.end,
            this.length,
        );

        for (const index of this.cache.keys()) {
            if (this.cache.size <= budgetRows) {
                return;
            }

            if (index < visibleRange.start || index >= visibleRange.end) {
                this.cache.delete(index);
            }
        }
    }

    private invalidateCachedData(notifyVisibleRange: boolean): void {
        this.generation++;
        this.cache.clear();
        this.placeholderCache.clear();
        this.pendingRequests.clear();

        if (notifyVisibleRange) {
            const visibleRange = normalizeRange(
                this.lastVisibleRange.start,
                this.lastVisibleRange.end,
                this.length,
            );
            if (visibleRange.end > visibleRange.start) {
                this.queueCollectionChanged(visibleRange.start, visibleRange.end);
            }
        }
    }

    private removeCachedRowsAtOrAfter(index: number): void {
        for (const rowIndex of this.cache.keys()) {
            if (rowIndex >= index) {
                this.cache.delete(rowIndex);
            }
        }

        for (const rowIndex of this.placeholderCache.keys()) {
            if (rowIndex >= index) {
                this.placeholderCache.delete(rowIndex);
            }
        }
    }

    private removePendingRequestsOutsideLength(): void {
        for (const [key, request] of this.pendingRequests) {
            if (request.start >= this.length) {
                this.pendingRequests.delete(key);
            }
        }
    }

    private queueCollectionChanged(start: number, end: number): void {
        if (this.disposed || end <= start) {
            return;
        }

        this.pendingChangedRanges.push({ start, end });

        if (this.collectionChangedTimer === undefined) {
            this.collectionChangedTimer = setTimeout(() => this.flushCollectionChanged(), 0);
        }
    }

    private flushCollectionChanged(): void {
        this.collectionChangedTimer = undefined;

        if (
            this.disposed ||
            !this.collectionChangedCallback ||
            this.pendingChangedRanges.length === 0
        ) {
            this.pendingChangedRanges = [];
            return;
        }

        const ranges = mergeRanges(this.pendingChangedRanges);
        this.pendingChangedRanges = [];

        for (const range of ranges) {
            this.collectionChangedCallback(range.start, range.end - range.start);
        }
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

    public setLength(length: number, resetData = false): void {
        const previous = this.getLength();
        const nextLength = toNonNegativeInteger(length);
        if (previous === nextLength) {
            return;
        }

        this.rowStore.setLength(nextLength, resetData);
        this.onRowCountChanged.notify({
            previous,
            current: nextLength,
            itemCount: nextLength,
            dataView: this as unknown as SlickDataView,
            callingOnRowsChanged: false,
        });
        this.scheduleRowCountUpdate();
        this.ensureViewportLoaded();
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
            options.windowedStoreOptions,
        ),
    );
}

function normalizeRange(start: number, end: number, length: number): Range {
    const normalizedLength = toNonNegativeInteger(length);
    const normalizedStart = clamp(toNonNegativeInteger(start), 0, normalizedLength);
    const normalizedEnd = clamp(toNonNegativeInteger(end), normalizedStart, normalizedLength);
    return { start: normalizedStart, end: normalizedEnd };
}

function mergeRanges(ranges: Range[]): Range[] {
    ranges.sort((left, right) => left.start - right.start || left.end - right.end);

    const merged: Range[] = [];
    for (const range of ranges) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end) {
            previous.end = Math.max(previous.end, range.end);
        } else {
            merged.push({ start: range.start, end: range.end });
        }
    }

    return merged;
}
