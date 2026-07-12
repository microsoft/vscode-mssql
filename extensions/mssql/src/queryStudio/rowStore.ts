/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RowStore (doc 04 §13.1–13.3, QO-6): per-execution result storage. Appends
 * compact pages from the sink, keeps a bounded memory cache split into
 * PROTECTED (viewport-fetched) and PROBATIONARY (appended/scanned) segments,
 * spills the remainder to length-prefixed JSON frames through a bounded
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
import { Perf } from "../perf/perfTelemetry";
import { CompactPage } from "../services/sqlDataPlane/api";
import { QsCellWindow, QsResultColumn } from "../sharedInterfaces/queryStudio";
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
}

export const DEFAULT_ROW_STORE_TUNING: RowStoreTuning = {
    maxPendingSpillBytes: QUERY_TUNING_DEFAULTS.maxPendingSpillBytes,
    protectedCacheRatio: QUERY_TUNING_DEFAULTS.protectedCacheRatio,
    windowCacheEntries: QUERY_TUNING_DEFAULTS.windowCacheEntries,
};

/**
 * Why a window is being read — drives cache admission policy. Scan reasons
 * (sample/profile/transform/aiTool, C2D; vectorAnalysis, VEC-3) stream
 * without re-admission like export/text so background analysis never evicts
 * the viewport.
 */
export type RowReadReason =
    | "grid"
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
    private windowCache = new Map<string, QsCellWindow>();
    // Row-pipeline attribution accumulators (QO-2): cheap adds on the hot
    // path, emitted as aggregates on query.complete via `stats`.
    private appendMsTotal = 0;
    private spillWrites = 0;
    private spillWriteMsTotal = 0;
    private spillReads = 0;
    private spillReadMsTotal = 0;
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
                this.windowCache.delete(key);
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
        appendMsTotal: number;
        spillWriteMsTotal: number;
        spillReadMsTotal: number;
        materializeMsTotal: number;
        pendingSpillBytes: number;
        appendBackpressureMsTotal: number;
        windowCacheHits: number;
        windowCacheMisses: number;
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
            appendMsTotal: roundMs(this.appendMsTotal),
            spillWriteMsTotal: roundMs(this.spillWriteMsTotal),
            spillReadMsTotal: roundMs(this.spillReadMsTotal),
            materializeMsTotal: roundMs(this.materializeMsTotal),
            pendingSpillBytes: this.pendingSpillBytes,
            appendBackpressureMsTotal: roundMs(this.appendBackpressureMsTotal),
            windowCacheHits: this.windowCacheHits,
            windowCacheMisses: this.windowCacheMisses,
            protectedPages: this.protectedPages.length,
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

        const cacheKey = ordinals
            ? `${resultSetId}:${start}:${count}:o:${ordinals.join(",")}`
            : `${resultSetId}:${start}:${count}:${columnStart}:${columnSpan}`;
        const cacheable = this.tuning.windowCacheEntries > 0 && reason === "grid";
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
                    rows: cached.rowCount,
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
                    ms: Date.now() - startedAt,
                });
                return cached;
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
        let fromSpill = false;
        let pagesVisited = 0;
        let pagesMaterialized = 0;
        let pagesMissing = 0;
        let nullCells = 0;
        let nonNullCells = 0;
        let nonEmptyCells = 0;
        // Per-cell content inspection is diagnostics-only work — priced only
        // at verbose/full (QO-2). The null bitmap is UI data and always built.
        const countCells = this.verbose;
        // Streaming/scan reads must not evict the viewport (QO-6, C2D):
        // only interactive read reasons re-admit pages to memory.
        const admit =
            reason === "grid" ||
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
            if (admit && reason === "grid" && page.compact) {
                this.promoteToProtected(set, page);
            }
            const from = Math.max(0, start - page.rowOffset);
            const to = Math.min(page.rowCount, end - page.rowOffset);
            const columnCount = set.columns.length;
            const nullBitmap = compact.nullBitmap
                ? Buffer.from(compact.nullBitmap, "base64")
                : undefined;
            for (let row = from; row < to; row++) {
                const sourceRow = compact.values[row] ?? [];
                values.push(
                    ordinals
                        ? ordinals.map((o) => sourceRow[o])
                        : projected
                          ? sourceRow.slice(columnStart, columnStart + columnSpan)
                          : sourceRow,
                );
                for (const col of projectedOrdinals) {
                    const nulled = hasNull(compact, row, col, columnCount, nullBitmap);
                    nullBits.push(nulled);
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
            ms: Date.now() - startedAt,
            ...(countCells
                ? {
                      cellSlots: values.length * set.columns.length,
                      nullCells,
                      nonNullCells,
                      nonEmptyCells,
                  }
                : {}),
        });
        const window: QsCellWindow = {
            resultSetId,
            start,
            rowCount: values.length,
            columns: projected
                ? set.columns.slice(columnStart, columnStart + columnSpan)
                : set.columns,
            values,
            nullBitmap: packBits(nullBits),
            ...(set.typeHints
                ? {
                      typeHints: projected
                          ? set.typeHints.slice(columnStart, columnStart + columnSpan)
                          : set.typeHints,
                  }
                : {}),
        };
        // Only complete, full-height windows cache (values are immutable, so
        // a fully-populated window stays valid as the set keeps streaming).
        if (cacheable && values.length === count && pagesMissing === 0) {
            this.windowCache.set(cacheKey, window);
            while (this.windowCache.size > this.tuning.windowCacheEntries) {
                const oldest = this.windowCache.keys().next().value;
                if (oldest === undefined) {
                    break;
                }
                this.windowCache.delete(oldest);
            }
        }
        return window;
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
            // Serialization happens HERE, off the append call stack (QO-5
            // will hand the store pre-encoded frames and delete this step).
            const frame = Buffer.from(JSON.stringify(page.compact), "utf8");
            if (this.spillBytes + frame.length + 4 > this.limits.maxSpillBytes) {
                this.spillFailed = true;
                return;
            }
            const header = Buffer.alloc(4);
            header.writeUInt32LE(frame.length, 0);
            const offset = this.spillBytes;
            await writeAt(fd, header, offset);
            await writeAt(fd, frame, offset + 4);
            page.spillOffset = offset;
            page.spillLength = frame.length;
            page.compact = undefined;
            this.spillBytes += frame.length + 4;
            this.memoryBytes -= page.approxBytes;
            const elapsed = performance.now() - startedAt;
            this.spillWrites++;
            this.spillWriteMsTotal += elapsed;
            if (this.verbose) {
                Perf.marker("mssql.queryStudio.rows.spill.write", "instant", {
                    resultSetId: set.resultSetId,
                    bytes: frame.length,
                    ms: roundMs(elapsed),
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
            const compact = JSON.parse(frame.toString("utf8")) as CompactPage;
            if (admit && !this.disposed) {
                // Re-admit to memory (read pages are likely re-read).
                page.compact = compact;
                this.memoryBytes += page.approxBytes;
                this.probationary.push({ set, page });
                this.evictIfNeeded();
            }
            const elapsed = performance.now() - startedAt;
            this.spillReads++;
            this.spillReadMsTotal += readMs;
            this.materializeMsTotal += elapsed;
            if (this.verbose) {
                Perf.marker("mssql.queryStudio.rows.spill.read", "instant", {
                    resultSetId: set.resultSetId,
                    bytes: page.spillLength ?? 0,
                    ms: roundMs(elapsed),
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
        this.disposed = true;
        this.resultSets.clear();
        this.probationary = [];
        this.protectedPages = [];
        this.windowCache.clear();
        const waiters = this.spillWaiters;
        this.spillWaiters = [];
        for (const release of waiters) {
            release();
        }
        // Close + delete after any in-flight write settles (best-effort; the
        // writer checks `disposed` before touching the fd). Chained so
        // flushSpill() awaited after dispose observes the cleanup too.
        this.spillChain = this.spillChain.then(() => {
            if (this.spillFd !== undefined) {
                try {
                    fs.closeSync(this.spillFd);
                } catch {
                    /* already closed */
                }
                this.spillFd = undefined;
            }
            if (this.spillPath) {
                try {
                    fs.rmSync(this.spillPath, { force: true });
                    fs.rmdirSync(this.spillDir);
                } catch {
                    /* best-effort delete; deactivate sweep catches leftovers */
                }
            }
        });
    }

    /** Test/diagnostic seam: resolves when queued spill writes have settled. */
    async flushSpill(): Promise<void> {
        await this.spillChain;
    }
}

function writeAt(fd: number, buffer: Buffer, position: number): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.write(fd, buffer, 0, buffer.length, position, (error) =>
            error ? reject(error) : resolve(),
        );
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
