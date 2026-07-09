/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RowStore (doc 04 §13.1–13.3): per-execution result storage. Appends
 * compact pages from the sink, keeps a bounded memory LRU, spills the
 * remainder to length-prefixed JSON frames (addendum §3.3 spill format v1),
 * and serves random cell windows for the grid.
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

interface StoredPage {
    rowOffset: number;
    rowCount: number;
    approxBytes: number;
    /** In memory when present; otherwise read from spill. */
    compact?: CompactPage;
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

export class RowStore {
    private resultSets = new Map<string, ResultSetStore>();
    private memoryBytes = 0;
    private spillBytes = 0;
    private spillFd: number | undefined;
    private spillPath: string | undefined;
    /** LRU of in-memory pages (resultSetId + index). */
    private lru: Array<{ set: ResultSetStore; page: StoredPage }> = [];
    private disposed = false;

    constructor(
        private readonly spillDir: string,
        private readonly limits: RowStoreLimits = DEFAULT_LIMITS,
    ) {}

    beginResultSet(resultSetId: string, columns: ResultSetColumns[]): void {
        this.resultSets.set(resultSetId, new ResultSetStore(resultSetId, columns));
    }

    /** Append a page; returns false when the row cap truncated the set. */
    appendPage(
        resultSetId: string,
        page: { rowOffset: number; rowCount: number; approxBytes: number; compact: CompactPage },
    ): boolean {
        const set = this.resultSets.get(resultSetId);
        if (!set || this.disposed) {
            return false;
        }
        if (set.rowCount + page.rowCount > this.limits.maxRowsPerResultSet) {
            set.truncatedReason = "maxRowsPerResultSet";
            return false;
        }
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
        this.lru.push({ set, page: stored });
        this.evictIfNeeded();
        return true;
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
        };
    }

    /**
     * Serve a cell window (doc 04 §13.3): locate pages by rowOffset, decode
     * from memory or spill, return the compact webview shape.
     */
    getRows(resultSetId: string, start: number, count: number): QsCellWindow {
        const startedAt = Date.now();
        Perf.marker("mssql.queryStudio.rows.windowFetch.begin", "begin", {
            resultSetId,
            start,
            count,
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
                columnCount: set?.columns.length ?? 0,
                pageCount: set?.pages.length ?? 0,
                availableRows: set?.rowCount ?? 0,
                pagesVisited: 0,
                pagesMaterialized: 0,
                pagesMissing: 0,
                cellSlots: 0,
                nullCells: 0,
                nonNullCells: 0,
                nonEmptyCells: 0,
                shortWindow: false,
                elapsedMs: Date.now() - startedAt,
            });
            return empty;
        }
        const end = Math.min(start + count, set.rowCount);
        const values: unknown[][] = [];
        const nullBits: boolean[] = [];
        let fromSpill = false;
        let pagesVisited = 0;
        let pagesMaterialized = 0;
        let pagesMissing = 0;
        let nullCells = 0;
        let nonNullCells = 0;
        let nonEmptyCells = 0;
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
            const compact = this.materialize(set, page);
            if (!compact) {
                pagesMissing++;
                continue; // spill read failure surfaces as short window
            }
            pagesMaterialized++;
            const from = Math.max(0, start - page.rowOffset);
            const to = Math.min(page.rowCount, end - page.rowOffset);
            const columnCount = set.columns.length;
            const nullBitmap = compact.nullBitmap
                ? Buffer.from(compact.nullBitmap, "base64")
                : undefined;
            for (let row = from; row < to; row++) {
                const sourceRow = compact.values[row] ?? [];
                values.push(sourceRow);
                for (let col = 0; col < columnCount; col++) {
                    const nulled = hasNull(compact, row, col, columnCount, nullBitmap);
                    nullBits.push(nulled);
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
            columnCount: set.columns.length,
            pageCount: set.pages.length,
            firstPageIndex,
            availableRows: set.rowCount,
            pagesVisited,
            pagesMaterialized,
            pagesMissing,
            cellSlots: values.length * set.columns.length,
            nullCells,
            nonNullCells,
            nonEmptyCells,
            shortWindow: values.length < end - start,
            elapsedMs: Date.now() - startedAt,
        });
        return {
            resultSetId,
            start,
            rowCount: values.length,
            columns: set.columns,
            values,
            nullBitmap: packBits(nullBits),
            ...(set.typeHints ? { typeHints: set.typeHints } : {}),
        };
    }

    // --- spill machinery -----------------------------------------------------

    private evictIfNeeded(): void {
        while (this.memoryBytes > this.limits.maxMemoryBytes && this.lru.length > 0) {
            const victim = this.lru.shift()!;
            if (!victim.page.compact) {
                continue;
            }
            if (!this.limits.spillEnabled) {
                // Honest backpressure: keep in memory, stop evicting; the
                // orchestrator pauses ingestion on memory pressure instead.
                this.lru.unshift(victim);
                return;
            }
            if (this.spillPage(victim.page)) {
                this.memoryBytes -= victim.page.approxBytes;
            } else {
                this.lru.unshift(victim);
                return;
            }
        }
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

    /** Length-prefixed JSON frame (spill format v1, addendum §3.3.2). */
    private spillPage(page: StoredPage): boolean {
        const fd = this.ensureSpillFile();
        if (fd === undefined || !page.compact) {
            return false;
        }
        const frame = Buffer.from(JSON.stringify(page.compact), "utf8");
        if (this.spillBytes + frame.length + 4 > this.limits.maxSpillBytes) {
            return false;
        }
        const header = Buffer.alloc(4);
        header.writeUInt32LE(frame.length, 0);
        try {
            const offset = this.spillBytes;
            fs.writeSync(fd, header, 0, 4, offset);
            fs.writeSync(fd, frame, 0, frame.length, offset + 4);
            page.spillOffset = offset;
            page.spillLength = frame.length;
            page.compact = undefined;
            this.spillBytes += frame.length + 4;
            return true;
        } catch {
            return false;
        }
    }

    private materialize(set: ResultSetStore, page: StoredPage): CompactPage | undefined {
        if (page.compact) {
            return page.compact;
        }
        if (this.spillFd === undefined || page.spillOffset === undefined) {
            return undefined;
        }
        try {
            const frame = Buffer.alloc(page.spillLength!);
            fs.readSync(this.spillFd, frame, 0, page.spillLength!, page.spillOffset + 4);
            const compact = JSON.parse(frame.toString("utf8")) as CompactPage;
            // Re-admit to memory LRU (read pages are likely re-read).
            page.compact = compact;
            this.memoryBytes += page.approxBytes;
            this.lru.push({ set, page });
            this.evictIfNeeded();
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
        this.lru = [];
        if (this.spillFd !== undefined) {
            try {
                fs.closeSync(this.spillFd);
            } catch {
                /* already closed */
            }
        }
        if (this.spillPath) {
            try {
                fs.rmSync(this.spillPath, { force: true });
                fs.rmdirSync(this.spillDir);
            } catch {
                /* best-effort delete; deactivate sweep catches leftovers */
            }
        }
    }
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

function packBits(bits: boolean[]): string {
    const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) {
            bytes[i >> 3] |= 1 << (i & 7);
        }
    }
    return bytes.toString("base64");
}
