/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RowStore (doc 04 §13.1–13.3, QO-6): per-execution result storage. Appends
 * compact pages from the sink, keeps a bounded memory cache split into
 * PROTECTED (viewport-fetched) and PROBATIONARY (appended/scanned) segments,
 * spills the remainder to length-prefixed V8 structured-clone frames through a bounded
 * ASYNC write queue (the extension host hot path never blocks on spill I/O;
 * queue saturation back-pressures appendPage, which holds the STS2 ack),
 * and serves random cell windows with a small served-window cache.
 *
 * Cache rules (EXECUTION_PLAN QO-6): grid-reason window fetches promote
 * pages to the protected segment; export/text streaming reads materialize
 * WITHOUT re-admission so a background export cannot evict the viewport.
 * Cell values are immutable once appended, so complete served windows cache
 * safely for the run's lifetime.
 *
 * Spill files CONTAIN RESULT DATA (doc 04 §13.2 binding rules): created
 * under the caller-provided root, deleted on dispose/new execution, excluded
 * from any export bundle, and the store reports spill bytes for the status
 * surface.
 */

import * as fs from "fs";
import * as path from "path";
import { deserialize, serialize } from "v8";
import { Perf } from "../perf/perfTelemetry";
import { CompactPage } from "../services/sqlDataPlane/api";
import { QsCellWindow, QsResultColumn } from "../sharedInterfaces/queryStudio";
import {
    cellDisplayText,
    cellDocumentLanguage,
    clampDisplay,
} from "../sharedInterfaces/queryStudioGridOps";
import {
    QUERY_TUNING_DEFAULTS,
    QueryTuningDiagnosticsLevel,
} from "../sharedInterfaces/queryTuning";

export interface RowStoreLimits {
    maxMemoryBytes: number;
    spillEnabled: boolean;
    maxSpillBytes: number;
    maxRowsPerResultSet: number;
}

export const DEFAULT_LIMITS: RowStoreLimits = {
    maxMemoryBytes: 64 * 1024 * 1024,
    spillEnabled: true,
    maxSpillBytes: 2048 * 1024 * 1024,
    maxRowsPerResultSet: 5_000_000,
};

/** QO-6 cache/backpressure knobs (QueryTuning params; defaults mirror the registry). */
export interface RowStoreTuning {
    /** Spill queue saturation point — appendPage awaits below this. */
    maxPendingSpillBytes: number;
    /** Fraction of maxMemoryBytes reserved for viewport-fetched pages. */
    protectedCacheRatio: number;
    /** Served-window cache entries (0 disables). */
    windowCacheEntries: number;
    /** Approximate retained-heap ceiling for served windows (0 disables). */
    windowCacheMaxBytes: number;
    /** Maximum display characters transported for one grid cell. */
    displayCellClamp: number;
}

export const DEFAULT_ROW_STORE_TUNING: RowStoreTuning = {
    maxPendingSpillBytes: QUERY_TUNING_DEFAULTS.maxPendingSpillBytes,
    protectedCacheRatio: QUERY_TUNING_DEFAULTS.protectedCacheRatio,
    windowCacheEntries: QUERY_TUNING_DEFAULTS.windowCacheEntries,
    windowCacheMaxBytes: QUERY_TUNING_DEFAULTS.windowCacheMaxBytes,
    displayCellClamp: QUERY_TUNING_DEFAULTS.displayCellClamp,
};

/**
 * Why a window is being read — drives cache admission policy. Scan reasons
 * (sample/profile/transform/aiTool, C2D; vectorAnalysis, VEC-3) stream
 * without re-admission like export/text so background analysis never evicts
 * the viewport.
 */
export type RowReadReason =
    | "grid"
    | "gridPreview"
    | "copy"
    | "export"
    | "text"
    | "cellDocument"
    | "diagnostic"
    | "sample"
    | "profile"
    | "transform"
    | "aiTool"
    | "vectorAnalysis"
    | "spatial";

interface StoredPage {
    rowOffset: number;
    rowCount: number;
    approxBytes: number;
    /** In memory when present; otherwise read from spill. */
    compact?: CompactPage;
    /** Queued for spill write; stays in memory until the write confirms. */
    spillPending?: boolean;
    /** Resident in the protected LRU segment (viewport-fetched). */
    protected?: boolean;
    /** Spill frame location when evicted. */
    spillOffset?: number;
    spillLength?: number;
}

export type ResultSetColumns = QsResultColumn;

class ResultSetStore {
    readonly pages: StoredPage[] = [];
    rowCount = 0;
    complete = false;
    truncatedReason: string | undefined;
    corrupt = false;
    typeHints: string[] | undefined;

    constructor(
        readonly resultSetId: string,
        readonly columns: ResultSetColumns[],
    ) {}
}

interface SpillJob {
    set: ResultSetStore;
    page: StoredPage;
}

interface CachedWindow {
    window: QsCellWindow;
    /** Approximate retained JS heap, not wire bytes. */
    approxBytes: number;
}

export class RowStore {
    private resultSets = new Map<string, ResultSetStore>();
    private memoryBytes = 0;
    private spillBytes = 0;
    private spillFd: number | undefined;
    private spillPath: string | undefined;
    /** Probationary LRU segment: appended + streaming-scanned pages. */
    private probationary: Array<{ set: ResultSetStore; page: StoredPage }> = [];
    /** Protected LRU segment: viewport-fetched pages (bounded slice of memory). */
    private protectedPages: Array<{ set: ResultSetStore; page: StoredPage }> = [];
    private disposed = false;
    /** Spill write pipeline: serialized, off the append hot path. */
    private spillChain: Promise<void> = Promise.resolve();
    private pendingSpillBytes = 0;
    private spillWaiters: Array<() => void> = [];
    /** Sticky spill failure: storage limit reached or I/O failed. */
    private spillFailed = false;
    /** Retained-store demotion (C2D): shrunken memory ceiling when set. */
    private memoryCapOverride: number | undefined;
    /** Served-window cache (immutable values ⇒ complete windows cache safely). */
    private windowCache = new Map<string, CachedWindow>();
    private windowCacheBytes = 0;
    private windowCachePeakBytes = 0;
    private windowCacheEvictions = 0;
    private windowCacheBypasses = 0;
    private windowCacheOversizeSkips = 0;
    private memoryBytesPeak = 0;
    private pendingSpillBytesPeak = 0;
    // Row-pipeline attribution accumulators (QO-2): cheap adds on the hot
    // path, emitted as aggregates on query.complete via `stats`.
    private appendMsTotal = 0;
    private spillWrites = 0;
    private spillWriteMsTotal = 0;
    private spillSerializeMsTotal = 0;
    private spillWriteIoMsTotal = 0;
    private spillReads = 0;
    private spillReadMsTotal = 0;
    private spillDeserializeMsTotal = 0;
    private materializeMsTotal = 0;
    private windowCacheHits = 0;
    private windowCacheMisses = 0;
    private appendBackpressureMsTotal = 0;

    constructor(
        private readonly spillDir: string,
        private readonly limits: RowStoreLimits = DEFAULT_LIMITS,
        /** Verbose/full adds per-page markers + per-cell window scan counts. */
        private readonly diagnostics: QueryTuningDiagnosticsLevel = "minimal",
        private readonly tuning: RowStoreTuning = DEFAULT_ROW_STORE_TUNING,
    ) {}

    private get verbose(): boolean {
        return this.diagnostics === "verbose" || this.diagnostics === "full";
    }

    beginResultSet(resultSetId: string, columns: ResultSetColumns[]): void {
        this.resultSets.set(resultSetId, new ResultSetStore(resultSetId, columns));
    }

    /**
     * Append a page; resolves false when the row cap or a storage limit
     * truncated the set (`summary().truncatedReason` says which). Awaits
     * spill-queue capacity when saturated — this is the backpressure point
     * that holds the STS2 ack (invariant: ack = real bounded acceptance).
     */
    async appendPage(
        resultSetId: string,
        page: { rowOffset: number; rowCount: number; approxBytes: number; compact: CompactPage },
    ): Promise<boolean> {
        const set = this.resultSets.get(resultSetId);
        if (!set || this.disposed) {
            return false;
        }
        if (set.rowCount + page.rowCount > this.limits.maxRowsPerResultSet) {
            set.truncatedReason = "maxRowsPerResultSet";
            return false;
        }
        if (this.spillFailed) {
            set.truncatedReason = "spillLimit";
            return false;
        }
        if (
            !this.limits.spillEnabled &&
            this.memoryBytes + page.approxBytes >
                this.limits.maxMemoryBytes + this.tuning.maxPendingSpillBytes
        ) {
            // No spill and past the hard memory allowance: honest refusal —
            // the orchestrator cancels with a clear storage-limit message.
            set.truncatedReason = "memoryLimit";
            return false;
        }
        const startedAt = performance.now();
        set.typeHints ??= page.compact.typeHints;
        const stored: StoredPage = {
            rowOffset: page.rowOffset,
            rowCount: page.rowCount,
            approxBytes: page.approxBytes,
            compact: page.compact,
        };
        set.pages.push(stored);
        set.rowCount += page.rowCount;
        this.memoryBytes += page.approxBytes;
        this.memoryBytesPeak = Math.max(this.memoryBytesPeak, this.memoryBytes);
        this.probationary.push({ set, page: stored });
        this.evictIfNeeded();
        const elapsed = performance.now() - startedAt;
        this.appendMsTotal += elapsed;
        if (this.verbose) {
            Perf.marker("mssql.queryStudio.rows.append", "instant", {
                resultSetId,
                rows: page.rowCount,
                bytes: page.approxBytes,
                ms: roundMs(elapsed),
            });
        }
        if (this.pendingSpillBytes > this.tuning.maxPendingSpillBytes) {
            const waitStartedAt = performance.now();
            await this.waitForSpillDrain();
            this.appendBackpressureMsTotal += performance.now() - waitStartedAt;
        }
        if (this.spillFailed) {
            // Storage limit / write failure surfaced while this page waited.
            set.truncatedReason ??= "spillLimit";
            return false;
        }
        return true;
    }

    /**
     * Lazily shrink the memory cap (C2D retained-store demotion, addendum
     * §5.1): lowers the ceiling and queues async spill for the overage —
     * nothing blocks on this call; memory releases as writes confirm.
     * An override, not a limits mutation: `limits` may be a shared default.
     */
    shrinkMemoryCap(maxMemoryBytes: number): void {
        if (this.disposed || maxMemoryBytes >= this.effectiveMemoryCap) {
            return;
        }
        this.memoryCapOverride = maxMemoryBytes;
        this.evictIfNeeded();
    }

    private get effectiveMemoryCap(): number {
        return this.memoryCapOverride ?? this.limits.maxMemoryBytes;
    }

    endResultSet(resultSetId: string, truncatedReason?: string): void {
        const set = this.resultSets.get(resultSetId);
        if (set) {
            set.complete = true;
            if (truncatedReason) {
                set.truncatedReason = truncatedReason;
            }
        }
    }

    markCorrupt(resultSetId: string): void {
        const set = this.resultSets.get(resultSetId);
        if (set) {
            set.corrupt = true;
        }
        // Served windows for a corrupt set may be short — drop them.
        for (const key of [...this.windowCache.keys()]) {
            if (key.startsWith(resultSetId + ":")) {
                this.deleteCachedWindow(key, false);
            }
        }
    }

    summary(resultSetId: string):
        | {
              rowCount: number;
              complete: boolean;
              truncatedReason?: string;
              corrupt: boolean;
              columns: ResultSetColumns[];
          }
        | undefined {
        const set = this.resultSets.get(resultSetId);
        if (!set) {
            return undefined;
        }
        return {
            rowCount: set.rowCount,
            complete: set.complete,
            ...(set.truncatedReason ? { truncatedReason: set.truncatedReason } : {}),
            corrupt: set.corrupt,
            columns: set.columns,
        };
    }

    get stats(): {
        memoryBytes: number;
        spillBytes: number;
        resultSets: number;
        pages: number;
        maxRowsPerResultSet: number;
        spillWrites: number;
        spillReads: number;
        spillEncoding: "json-v1" | "v8-v1";
        appendMsTotal: number;
        spillWriteMsTotal: number;
        spillSerializeMsTotal: number;
        spillWriteIoMsTotal: number;
        spillReadMsTotal: number;
        spillDeserializeMsTotal: number;
        materializeMsTotal: number;
        pendingSpillBytes: number;
        pendingSpillBytesPeak: number;
        appendBackpressureMsTotal: number;
        windowCacheHits: number;
        windowCacheMisses: number;
        windowCacheBytes: number;
        windowCachePeakBytes: number;
        windowCacheEntries: number;
        windowCacheEvictions: number;
        windowCacheBypasses: number;
        windowCacheOversizeSkips: number;
        windowCacheMaxBytes: number;
        memoryBytesPeak: number;
        protectedPages: number;
    } {
        return {
            memoryBytes: this.memoryBytes,
            spillBytes: this.spillBytes,
            resultSets: this.resultSets.size,
            pages: [...this.resultSets.values()].reduce(
                (total, set) => total + set.pages.length,
                0,
            ),
            maxRowsPerResultSet: this.limits.maxRowsPerResultSet,
            spillWrites: this.spillWrites,
            spillReads: this.spillReads,
            spillEncoding: "v8-v1",
            appendMsTotal: roundMs(this.appendMsTotal),
            spillWriteMsTotal: roundMs(this.spillWriteMsTotal),
            spillSerializeMsTotal: roundMs(this.spillSerializeMsTotal),
            spillWriteIoMsTotal: roundMs(this.spillWriteIoMsTotal),
            spillReadMsTotal: roundMs(this.spillReadMsTotal),
            spillDeserializeMsTotal: roundMs(this.spillDeserializeMsTotal),
            materializeMsTotal: roundMs(this.materializeMsTotal),
            pendingSpillBytes: this.pendingSpillBytes,
            pendingSpillBytesPeak: this.pendingSpillBytesPeak,
            appendBackpressureMsTotal: roundMs(this.appendBackpressureMsTotal),
            windowCacheHits: this.windowCacheHits,
            windowCacheMisses: this.windowCacheMisses,
            windowCacheBytes: this.windowCacheBytes,
            windowCachePeakBytes: this.windowCachePeakBytes,
            windowCacheEntries: this.windowCache.size,
            windowCacheEvictions: this.windowCacheEvictions,
            windowCacheBypasses: this.windowCacheBypasses,
            windowCacheOversizeSkips: this.windowCacheOversizeSkips,
            windowCacheMaxBytes: this.tuning.windowCacheMaxBytes,
            memoryBytesPeak: this.memoryBytesPeak,
            protectedPages: this.protectedPages.length,
        };
    }

    private get cachePerfAttrs(): Record<string, number> {
        return {
            residentPageBytes: this.memoryBytes,
            pendingSpillBytes: this.pendingSpillBytes,
            windowCacheBytes: this.windowCacheBytes,
            windowCacheEntries: this.windowCache.size,
            windowCacheEvictions: this.windowCacheEvictions,
            windowCacheBypasses: this.windowCacheBypasses,
            windowCacheOversizeSkips: this.windowCacheOversizeSkips,
            windowCacheMaxBytes: this.tuning.windowCacheMaxBytes,
        };
    }

    /**
     * Serve a cell window (doc 04 §13.3): locate pages by rowOffset, decode
     * from memory or spill, return the compact webview shape. Grid-reason
     * reads promote pages to the protected cache segment; export/text reads
     * stream WITHOUT admission so scans never evict the viewport.
     * `columns` projects the window horizontally: a contiguous span (QO-7b —
     * wide-grid copy, viewport fetches) or sparse ordinals (VEC-3 — a vector
     * scan reads the vector column plus distant key/label columns with ONE
     * spill materialization per page, never one per column).
     */
    async getRows(
        resultSetId: string,
        start: number,
        count: number,
        reason: RowReadReason = "grid",
        columns?: { start: number; count: number } | { ordinals: readonly number[] },
    ): Promise<QsCellWindow> {
        const startedAt = Date.now();
        Perf.marker("mssql.queryStudio.rows.windowFetch.begin", "begin", {
            resultSetId,
            start,
            count,
            reason,
            ...(columns && !("ordinals" in columns)
                ? { columnStart: columns.start, columnSpan: columns.count }
                : {}),
            ...(columns && "ordinals" in columns
                ? { columnOrdinals: columns.ordinals.length }
                : {}),
        });
        const set = this.resultSets.get(resultSetId);
        const empty: QsCellWindow = {
            resultSetId,
            start,
            rowCount: 0,
            columns: set?.columns ?? [],
            values: [],
        };
        if (!set || count <= 0 || start >= set.rowCount) {
            Perf.marker("mssql.queryStudio.rows.windowFetch.end", "end", {
                resultSetId,
                start,
                count,
                rows: 0,
                fromSpill: false,
                cacheHit: true,
                columnCount: set?.columns.length ?? 0,
                pageCount: set?.pages.length ?? 0,
                availableRows: set?.rowCount ?? 0,
                pagesVisited: 0,
                materializedPages: 0,
                pagesMissing: 0,
                shortWindow: false,
                ms: Date.now() - startedAt,
                ...this.cachePerfAttrs,
            });
            return empty;
        }

        // Horizontal projection: clamp to the set's real columns; undefined =
        // all columns (legacy shape). Sparse ordinals (VEC-3) keep caller
        // order; invalid ordinals are dropped, never clamped to a neighbor.
        const totalColumns = set.columns.length;
        const ordinals =
            columns && "ordinals" in columns
                ? columns.ordinals.filter((o) => Number.isInteger(o) && o >= 0 && o < totalColumns)
                : undefined;
        const contiguous = columns && !("ordinals" in columns) ? columns : undefined;
        const columnStart = contiguous ? Math.max(0, Math.min(contiguous.start, totalColumns)) : 0;
        const columnSpan = contiguous
            ? Math.max(0, Math.min(contiguous.count, totalColumns - columnStart))
            : totalColumns;
        const projected =
            ordinals !== undefined || columnStart !== 0 || columnSpan !== totalColumns;

        const gridPreview = reason === "gridPreview";
        const interactiveGrid = gridPreview || reason === "grid";
        const cacheKey = ordinals
            ? `${resultSetId}:${gridPreview ? "p" : "r"}:${start}:${count}:o:${ordinals.join(",")}`
            : `${resultSetId}:${gridPreview ? "p" : "r"}:${start}:${count}:${columnStart}:${columnSpan}`;
        const cacheEnabled =
            interactiveGrid &&
            this.tuning.windowCacheEntries > 0 &&
            this.tuning.windowCacheMaxBytes > 0;
        // Growing prefixes have a new key on every row and cannot hit again;
        // admitting them only retains stale cumulative windows. Start caching
        // once the result set is terminal and its window identities stabilize.
        const cacheable = cacheEnabled && set.complete;
        if (interactiveGrid && !cacheable) {
            this.windowCacheBypasses++;
        }
        if (cacheable) {
            const cached = this.windowCache.get(cacheKey);
            if (cached) {
                // LRU touch.
                this.windowCache.delete(cacheKey);
                this.windowCache.set(cacheKey, cached);
                this.windowCacheHits++;
                Perf.marker("mssql.queryStudio.rows.windowFetch.end", "end", {
                    resultSetId,
                    start,
                    count,
                    rows: cached.window.rowCount,
                    fromSpill: false,
                    cacheHit: true,
                    windowCache: true,
                    columnCount: set.columns.length,
                    pageCount: set.pages.length,
                    availableRows: set.rowCount,
                    pagesVisited: 0,
                    materializedPages: 0,
                    pagesMissing: 0,
                    shortWindow: false,
                    gridPreview,
                    returnedValueCharacters: countWindowValueCharacters(cached.window),
                    ms: Date.now() - startedAt,
                    ...this.cachePerfAttrs,
                });
                return cached.window;
            }
            this.windowCacheMisses++;
        }

        const end = Math.min(start + count, set.rowCount);
        // The projected column ordinals, fixed for the whole request (sparse
        // keeps caller order; contiguous expands the span once, not per row).
        const projectedOrdinals =
            ordinals ?? Array.from({ length: columnSpan }, (_, i) => columnStart + i);
        const values: unknown[][] = [];
        const nullBits: boolean[] = [];
        const documentLanguages: Array<"xml" | "json" | null> | undefined = gridPreview
            ? []
            : undefined;
        let sourceValueCharacters = 0;
        let returnedValueCharacters = 0;
        let fromSpill = false;
        let pagesVisited = 0;
        let pagesMaterialized = 0;
        let pagesMissing = 0;
        let nullCells = 0;
        let nonNullCells = 0;
        let nonEmptyCells = 0;
        let gridPreviewTransformMs = 0;
        // Per-cell content inspection is diagnostics-only work — priced only
        // at verbose/full (QO-2). The null bitmap is UI data and always built.
        const countCells = this.verbose;
        // Streaming/scan reads must not evict the viewport (QO-6, C2D):
        // only interactive read reasons re-admit pages to memory.
        const admit =
            reason === "grid" ||
            reason === "gridPreview" ||
            reason === "copy" ||
            reason === "cellDocument" ||
            reason === "diagnostic";
        const firstPageIndex = firstOverlappingPageIndex(set.pages, start);
        for (let pageIndex = firstPageIndex; pageIndex < set.pages.length; pageIndex++) {
            const page = set.pages[pageIndex];
            const pageEnd = page.rowOffset + page.rowCount;
            if (pageEnd <= start || page.rowOffset >= end) {
                break;
            }
            pagesVisited++;
            if (!page.compact) {
                fromSpill = true;
            }
            const compact = await this.materialize(set, page, admit);
            if (!compact) {
                pagesMissing++;
                continue; // spill read failure surfaces as short window
            }
            pagesMaterialized++;
            if (admit && interactiveGrid && page.compact) {
                this.promoteToProtected(set, page);
            }
            const from = Math.max(0, start - page.rowOffset);
            const to = Math.min(page.rowCount, end - page.rowOffset);
            const columnCount = set.columns.length;
            const nullBitmap = compact.nullBitmap
                ? Buffer.from(compact.nullBitmap, "base64")
                : undefined;
            const previewTransformStartedAt = gridPreview ? performance.now() : 0;
            for (let row = from; row < to; row++) {
                const sourceRow = compact.values[row] ?? [];
                const targetRow: unknown[] = gridPreview
                    ? new Array(projectedOrdinals.length)
                    : ordinals
                      ? ordinals.map((o) => sourceRow[o])
                      : projected
                        ? sourceRow.slice(columnStart, columnStart + columnSpan)
                        : sourceRow;
                values.push(targetRow);
                let targetColumn = 0;
                for (const col of projectedOrdinals) {
                    const nulled = hasNull(compact, row, col, columnCount, nullBitmap);
                    nullBits.push(nulled);
                    if (gridPreview) {
                        const sourceValue = sourceRow[col];
                        if (nulled) {
                            targetRow[targetColumn] = undefined;
                            documentLanguages!.push(null);
                        } else {
                            sourceValueCharacters += retainedCellPayloadCharacters(sourceValue);
                            const displayText = cellDisplayText(sourceValue);
                            const preview = clampDisplay(displayText, this.tuning.displayCellClamp);
                            targetRow[targetColumn] = preview;
                            returnedValueCharacters += preview.length;
                            const metadata = set.columns[col];
                            documentLanguages!.push(
                                cellDocumentLanguage(
                                    sourceValue,
                                    {
                                        sqlType: metadata?.sqlType,
                                        typeHint: set.typeHints?.[col],
                                        isXml: metadata?.isXml,
                                        isJson: metadata?.isJson,
                                    },
                                    displayText,
                                ) ?? null,
                            );
                        }
                        targetColumn++;
                    }
                    if (!countCells) {
                        continue;
                    }
                    if (nulled) {
                        nullCells++;
                    } else {
                        nonNullCells++;
                        if (hasNonEmptyValue(sourceRow[col])) {
                            nonEmptyCells++;
                        }
                    }
                }
            }
            if (gridPreview) {
                gridPreviewTransformMs += performance.now() - previewTransformStartedAt;
            }
        }
        const window: QsCellWindow = {
            resultSetId,
            start,
            rowCount: values.length,
            columns: ordinals
                ? ordinals.map((ordinal) => set.columns[ordinal])
                : projected
                  ? set.columns.slice(columnStart, columnStart + columnSpan)
                  : set.columns,
            values,
            nullBitmap: packBits(nullBits),
            ...(gridPreview
                ? {
                      valueMode: "gridPreview" as const,
                      documentLanguages,
                  }
                : {}),
            ...(set.typeHints
                ? {
                      typeHints: ordinals
                          ? ordinals.map((ordinal) => set.typeHints![ordinal])
                          : projected
                            ? set.typeHints.slice(columnStart, columnStart + columnSpan)
                            : set.typeHints,
                  }
                : {}),
        };
        // Only complete, full-height terminal windows cache. Values are
        // immutable, and both entry and retained-byte budgets bound the LRU.
        if (cacheable && values.length === count && pagesMissing === 0) {
            this.setCachedWindow(cacheKey, window);
        }
        Perf.marker("mssql.queryStudio.rows.windowFetch.end", "end", {
            resultSetId,
            start,
            count,
            rows: values.length,
            fromSpill,
            cacheHit: !fromSpill && pagesMissing === 0,
            columnCount: set.columns.length,
            pageCount: set.pages.length,
            firstPageIndex,
            availableRows: set.rowCount,
            pagesVisited,
            materializedPages: pagesMaterialized,
            pagesMissing,
            shortWindow: values.length < end - start,
            gridPreview,
            ...(gridPreview
                ? {
                      gridPreviewTransformMs: Math.round(gridPreviewTransformMs * 100) / 100,
                  }
                : {}),
            sourceValueCharacters,
            returnedValueCharacters,
            ms: Date.now() - startedAt,
            ...this.cachePerfAttrs,
            ...(countCells
                ? {
                      cellSlots: values.length * set.columns.length,
                      nullCells,
                      nonNullCells,
                      nonEmptyCells,
                  }
                : {}),
        });
        return window;
    }

    private setCachedWindow(key: string, window: QsCellWindow): void {
        this.deleteCachedWindow(key, false);
        const cached = { window, approxBytes: estimateWindowRetainedBytes(window) };
        if (cached.approxBytes > this.tuning.windowCacheMaxBytes) {
            this.windowCacheOversizeSkips++;
            return;
        }
        while (
            this.windowCache.size >= this.tuning.windowCacheEntries ||
            this.windowCacheBytes + cached.approxBytes > this.tuning.windowCacheMaxBytes
        ) {
            const oldest = this.windowCache.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.deleteCachedWindow(oldest, true);
        }
        this.windowCache.set(key, cached);
        this.windowCacheBytes += cached.approxBytes;
        this.windowCachePeakBytes = Math.max(this.windowCachePeakBytes, this.windowCacheBytes);
    }

    private deleteCachedWindow(key: string, eviction: boolean): void {
        const cached = this.windowCache.get(key);
        if (!cached) {
            return;
        }
        this.windowCache.delete(key);
        this.windowCacheBytes = Math.max(0, this.windowCacheBytes - cached.approxBytes);
        if (eviction) {
            this.windowCacheEvictions++;
        }
    }

    // --- cache segments --------------------------------------------------------

    private promoteToProtected(set: ResultSetStore, page: StoredPage): void {
        if (page.protected) {
            return;
        }
        const index = this.probationary.findIndex((entry) => entry.page === page);
        if (index >= 0) {
            this.probationary.splice(index, 1);
        }
        page.protected = true;
        this.protectedPages.push({ set, page });
        // Protected segment is a bounded slice of memory: overflow demotes
        // the oldest protected page back to probationary (it stays resident
        // until ordinary eviction reaches it).
        const protectedCap = Math.max(
            0,
            Math.floor(this.effectiveMemoryCap * this.tuning.protectedCacheRatio),
        );
        let protectedBytes = this.protectedPages.reduce(
            (total, entry) => total + entry.page.approxBytes,
            0,
        );
        while (protectedBytes > protectedCap && this.protectedPages.length > 1) {
            const demoted = this.protectedPages.shift()!;
            demoted.page.protected = false;
            protectedBytes -= demoted.page.approxBytes;
            this.probationary.push(demoted);
        }
    }

    // --- spill machinery -----------------------------------------------------

    private evictIfNeeded(): void {
        // Victims come from probationary first; protected pages spill only
        // when nothing else remains. Pages stay resident (spillPending) until
        // the async write confirms — memory releases on completion.
        while (
            this.memoryBytes - this.pendingSpillBytes > this.effectiveMemoryCap &&
            this.limits.spillEnabled &&
            !this.spillFailed
        ) {
            const victim = this.takeEvictionVictim();
            if (!victim) {
                return;
            }
            if (!victim.page.compact || victim.page.spillPending) {
                continue;
            }
            if (victim.page.spillOffset !== undefined) {
                // Churn protection: a re-admitted page already has a spill
                // frame — drop the decoded copy instead of rewriting it.
                victim.page.compact = undefined;
                this.memoryBytes -= victim.page.approxBytes;
                continue;
            }
            this.queueSpill(victim.set, victim.page);
        }
    }

    private takeEvictionVictim(): { set: ResultSetStore; page: StoredPage } | undefined {
        while (this.probationary.length > 0) {
            const candidate = this.probationary.shift()!;
            if (candidate.page.compact && !candidate.page.spillPending) {
                return candidate;
            }
        }
        while (this.protectedPages.length > 0) {
            const candidate = this.protectedPages.shift()!;
            candidate.page.protected = false;
            if (candidate.page.compact && !candidate.page.spillPending) {
                return candidate;
            }
        }
        return undefined;
    }

    private queueSpill(set: ResultSetStore, page: StoredPage): void {
        page.spillPending = true;
        this.pendingSpillBytes += page.approxBytes;
        this.pendingSpillBytesPeak = Math.max(this.pendingSpillBytesPeak, this.pendingSpillBytes);
        const job: SpillJob = { set, page };
        this.spillChain = this.spillChain.then(() => this.writeSpillJob(job));
    }

    private async writeSpillJob(job: SpillJob): Promise<void> {
        const { set, page } = job;
        try {
            if (this.disposed || !page.compact) {
                return;
            }
            const fd = this.ensureSpillFile();
            if (fd === undefined) {
                this.spillFailed = true;
                return;
            }
            const startedAt = performance.now();
            // Session-local spill never crosses a process/runtime boundary, so
            // V8 structured clone avoids JSON's full UTF-16 stringify/parse copy.
            const serializeStartedAt = performance.now();
            const frame = serialize(page.compact);
            const serializeMs = performance.now() - serializeStartedAt;
            if (this.spillBytes + frame.length + 4 > this.limits.maxSpillBytes) {
                this.spillFailed = true;
                return;
            }
            const header = Buffer.alloc(4);
            header.writeUInt32LE(frame.length, 0);
            const offset = this.spillBytes;
            const ioStartedAt = performance.now();
            await writeBuffersAt(fd, [header, frame], offset);
            const ioMs = performance.now() - ioStartedAt;
            page.spillOffset = offset;
            page.spillLength = frame.length;
            page.compact = undefined;
            this.spillBytes += frame.length + 4;
            this.memoryBytes -= page.approxBytes;
            const elapsed = performance.now() - startedAt;
            this.spillWrites++;
            this.spillWriteMsTotal += elapsed;
            this.spillSerializeMsTotal += serializeMs;
            this.spillWriteIoMsTotal += ioMs;
            if (this.verbose) {
                Perf.marker("mssql.queryStudio.rows.spill.write", "instant", {
                    resultSetId: set.resultSetId,
                    bytes: frame.length,
                    ms: roundMs(elapsed),
                    serializeMs: roundMs(serializeMs),
                    ioMs: roundMs(ioMs),
                    encoding: "v8-v1",
                });
            }
        } catch {
            this.spillFailed = true;
        } finally {
            page.spillPending = false;
            this.pendingSpillBytes -= page.approxBytes;
            const waiters = this.spillWaiters;
            this.spillWaiters = [];
            for (const release of waiters) {
                release();
            }
        }
    }

    private waitForSpillDrain(): Promise<void> {
        if (this.pendingSpillBytes <= this.tuning.maxPendingSpillBytes || this.disposed) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const check = () => {
                if (
                    this.pendingSpillBytes <= this.tuning.maxPendingSpillBytes ||
                    this.disposed ||
                    this.spillFailed
                ) {
                    resolve();
                } else {
                    this.spillWaiters.push(check);
                }
            };
            this.spillWaiters.push(check);
        });
    }

    private ensureSpillFile(): number | undefined {
        if (this.spillFd !== undefined) {
            return this.spillFd;
        }
        try {
            fs.mkdirSync(this.spillDir, { recursive: true });
            this.spillPath = path.join(this.spillDir, "resultsets.pages");
            this.spillFd = fs.openSync(this.spillPath, "w+");
            return this.spillFd;
        } catch {
            return undefined;
        }
    }

    /**
     * Decode one page from memory or spill. `admit` controls memory
     * re-admission: viewport reads re-admit (likely re-read), streaming
     * export/text reads return a transient decode and leave the cache alone.
     */
    private async materialize(
        set: ResultSetStore,
        page: StoredPage,
        admit: boolean,
    ): Promise<CompactPage | undefined> {
        if (page.compact) {
            return page.compact;
        }
        if (this.spillFd === undefined || page.spillOffset === undefined) {
            return undefined;
        }
        const startedAt = performance.now();
        try {
            const frame = Buffer.alloc(page.spillLength!);
            await readAt(this.spillFd, frame, page.spillOffset + 4);
            const readMs = performance.now() - startedAt;
            const deserializeStartedAt = performance.now();
            const compact = deserialize(frame) as CompactPage;
            const deserializeMs = performance.now() - deserializeStartedAt;
            if (admit && !this.disposed) {
                // Re-admit to memory (read pages are likely re-read).
                page.compact = compact;
                this.memoryBytes += page.approxBytes;
                this.memoryBytesPeak = Math.max(this.memoryBytesPeak, this.memoryBytes);
                this.probationary.push({ set, page });
                this.evictIfNeeded();
            }
            const elapsed = performance.now() - startedAt;
            this.spillReads++;
            this.spillReadMsTotal += readMs;
            this.spillDeserializeMsTotal += deserializeMs;
            this.materializeMsTotal += elapsed;
            if (this.verbose) {
                Perf.marker("mssql.queryStudio.rows.spill.read", "instant", {
                    resultSetId: set.resultSetId,
                    bytes: page.spillLength ?? 0,
                    ms: roundMs(elapsed),
                    ioMs: roundMs(readMs),
                    deserializeMs: roundMs(deserializeMs),
                    encoding: "v8-v1",
                });
            }
            return compact;
        } catch {
            set.corrupt = true;
            return undefined;
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        const disposeStartedAt = performance.now();
        Perf.marker("mssql.queryStudio.rows.dispose.begin", "begin", {
            resultSets: this.resultSets.size,
            residentPageBytes: this.memoryBytes,
            spillBytes: this.spillBytes,
            spillWrites: this.spillWrites,
            spillReads: this.spillReads,
            windowCacheBytes: this.windowCacheBytes,
        });
        this.disposed = true;
        this.resultSets.clear();
        this.probationary = [];
        this.protectedPages = [];
        this.windowCache.clear();
        this.windowCacheBytes = 0;
        const waiters = this.spillWaiters;
        this.spillWaiters = [];
        for (const release of waiters) {
            release();
        }
        // Close + delete after any in-flight write settles (best-effort; the
        // writer checks `disposed` before touching the fd). Chained so
        // flushSpill() awaited after dispose observes the cleanup too.
        this.spillChain = this.spillChain.then(() => {
            let cleanupFailed = false;
            if (this.spillFd !== undefined) {
                try {
                    fs.closeSync(this.spillFd);
                } catch {
                    cleanupFailed = true;
                }
                this.spillFd = undefined;
            }
            if (this.spillPath) {
                try {
                    fs.rmSync(this.spillPath, { force: true });
                    fs.rmdirSync(this.spillDir);
                } catch {
                    cleanupFailed = true;
                }
            }
            Perf.marker("mssql.queryStudio.rows.dispose.end", "end", {
                outcome: cleanupFailed ? "bestEffortFailure" : "ok",
                spillFileRemoved: this.spillPath ? !fs.existsSync(this.spillPath) : true,
                ms: roundMs(performance.now() - disposeStartedAt),
            });
        });
    }

    /** Test/diagnostic seam: resolves when queued spill writes have settled. */
    async flushSpill(): Promise<void> {
        await this.spillChain;
    }
}

/**
 * Cheap retained-heap estimate for decoded served windows. This deliberately
 * models JS strings as UTF-16 and includes array/object slot overhead; it is
 * a memory-budget signal, not a serialized payload measurement.
 */
function estimateWindowRetainedBytes(window: QsCellWindow): number {
    const seen = new Set<object>();
    let bytes = 160;
    bytes += retainedStringBytes(window.resultSetId);
    bytes += window.nullBitmap ? retainedStringBytes(window.nullBitmap) : 0;
    bytes += window.columns.length * 16;
    for (const column of window.columns) {
        bytes += estimateRetainedValue(column, seen, 0);
    }
    bytes += window.values.length * 16;
    for (const row of window.values) {
        bytes += 24 + row.length * 8;
        for (const value of row) {
            bytes += estimateRetainedValue(value, seen, 0);
        }
    }
    if (window.typeHints) {
        bytes += window.typeHints.length * 8;
        for (const hint of window.typeHints) {
            bytes += retainedStringBytes(hint);
        }
    }
    if (window.valueMode) {
        bytes += retainedStringBytes(window.valueMode);
    }
    if (window.documentLanguages) {
        bytes += window.documentLanguages.length * 8;
        for (const language of window.documentLanguages) {
            if (language) {
                bytes += retainedStringBytes(language);
            }
        }
    }
    return bytes;
}

function countWindowValueCharacters(window: QsCellWindow): number {
    let characters = 0;
    for (const row of window.values) {
        for (const value of row) {
            characters += retainedCellPayloadCharacters(value);
        }
    }
    return characters;
}

/** Cheap aggregate size signal for common scalar and typed-wire payloads. */
function retainedCellPayloadCharacters(value: unknown): number {
    if (typeof value === "string") {
        return value.length;
    }
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
        return String(value).length;
    }
    if (value === null || value === undefined || typeof value !== "object") {
        return 0;
    }
    const record = value as Record<string, unknown>;
    for (const key of ["v", "data", "wkb"] as const) {
        if (typeof record[key] === "string") {
            return record[key].length;
        }
    }
    return 0;
}

function estimateRetainedValue(value: unknown, seen: Set<object>, depth: number): number {
    if (value === null || value === undefined) {
        return 0;
    }
    switch (typeof value) {
        case "string":
            return retainedStringBytes(value);
        case "number":
        case "bigint":
            return 8;
        case "boolean":
            return 4;
        case "object": {
            if (seen.has(value)) {
                return 0;
            }
            seen.add(value);
            if (Buffer.isBuffer(value)) {
                return 40 + value.byteLength;
            }
            if (ArrayBuffer.isView(value)) {
                return 40 + value.byteLength;
            }
            if (depth >= 3) {
                return 64;
            }
            if (Array.isArray(value)) {
                return (
                    24 +
                    value.length * 8 +
                    value.reduce(
                        (total, item) => total + estimateRetainedValue(item, seen, depth + 1),
                        0,
                    )
                );
            }
            let bytes = 48;
            for (const [key, item] of Object.entries(value)) {
                bytes += retainedStringBytes(key) + 8;
                bytes += estimateRetainedValue(item, seen, depth + 1);
            }
            return bytes;
        }
        default:
            return 0;
    }
}

function retainedStringBytes(value: string): number {
    return 24 + value.length * 2;
}

function writeBuffersAt(fd: number, buffers: readonly Buffer[], position: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const pending = buffers.filter((buffer) => buffer.length > 0).slice();
        const writeNext = (): void => {
            if (pending.length === 0) {
                resolve();
                return;
            }
            fs.writev(fd, pending, position, (error, bytesWritten) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (bytesWritten <= 0) {
                    reject(new Error("Spill write made no forward progress"));
                    return;
                }
                position += bytesWritten;
                let consumed = bytesWritten;
                while (pending.length > 0 && consumed >= pending[0].length) {
                    consumed -= pending[0].length;
                    pending.shift();
                }
                if (consumed > 0 && pending.length > 0) {
                    pending[0] = pending[0].subarray(consumed);
                }
                writeNext();
            });
        };
        writeNext();
    });
}

function readAt(fd: number, buffer: Buffer, position: number): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.read(fd, buffer, 0, buffer.length, position, (error) =>
            error ? reject(error) : resolve(),
        );
    });
}

function firstOverlappingPageIndex(pages: readonly StoredPage[], start: number): number {
    let low = 0;
    let high = pages.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        const page = pages[mid];
        const pageEnd = page.rowOffset + page.rowCount;
        if (pageEnd <= start) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

function hasNull(
    page: CompactPage,
    row: number,
    col: number,
    columnCount: number,
    nullBitmap?: Buffer,
): boolean {
    if (!nullBitmap) {
        return page.values[row]?.[col] === undefined || page.values[row]?.[col] === null;
    }
    const index = row * columnCount + col;
    const byteIndex = index >> 3;
    return byteIndex < nullBitmap.length && (nullBitmap[byteIndex] & (1 << (index & 7))) !== 0;
}

function hasNonEmptyValue(value: unknown): boolean {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === "string") {
        return value.length > 0;
    }
    return true;
}

function roundMs(ms: number): number {
    return Math.round(ms * 100) / 100;
}

function packBits(bits: boolean[]): string {
    const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) {
            bytes[i >> 3] |= 1 << (i & 7);
        }
    }
    return bytes.toString("base64");
}
