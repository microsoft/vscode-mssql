/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Memory-pressure circuit breaker (TSQ2 addendum §5.13): a LAST-RESORT guard
 * that terminates a native query with a typed ResourceLimit before the
 * extension host reaches catastrophic OOM. It is not a substitute for PLP
 * streaming (types.largeValueStreaming stays unsupported) — driver/parser
 * buffering is exactly the memory this samples.
 *
 * Off unless a budget is configured (zero overhead by default); sampling is
 * bounded by interval, never per row. Snapshots are safe process facts
 * (bytes only) recorded for the support capsule.
 */

export interface MemorySnapshot {
    heapUsedBytes: number;
    externalBytes: number;
    /** Absent when the host runtime does not expose this Node memory field. */
    arrayBuffersBytes?: number;
    rssBytes: number;
}

export interface MemoryReader {
    sample(): MemorySnapshot;
}

export function productionMemoryReader(): MemoryReader {
    return {
        sample(): MemorySnapshot {
            const usage = process.memoryUsage();
            return {
                heapUsedBytes: usage.heapUsed,
                externalBytes: usage.external,
                ...(typeof usage.arrayBuffers === "number"
                    ? { arrayBuffersBytes: usage.arrayBuffers }
                    : {}),
                rssBytes: usage.rss,
            };
        },
    };
}

export interface MemoryBudgetConfig {
    /** Combined heap+external budget in bytes; breach trips the breaker. */
    maxUsedBytes: number;
    /** Minimum ms between samples (bounds the sampling cost). */
    sampleEveryMs: number;
}

export interface MemoryPressureVerdict {
    pressure: boolean;
    snapshot?: MemorySnapshot;
}

export class MemoryBreaker {
    private lastSampleAt = -Infinity;
    private lastSnapshot: MemorySnapshot | undefined;

    constructor(
        private readonly reader: MemoryReader,
        private readonly config: MemoryBudgetConfig,
        private readonly now: () => number,
    ) {}

    /** Called at bounded points (page enqueue); samples at most per interval. */
    check(): MemoryPressureVerdict {
        const at = this.now();
        if (at - this.lastSampleAt < this.config.sampleEveryMs) {
            return { pressure: false };
        }
        this.lastSampleAt = at;
        const snapshot = this.reader.sample();
        this.lastSnapshot = snapshot;
        const used = snapshot.heapUsedBytes + snapshot.externalBytes;
        if (used >= this.config.maxUsedBytes) {
            return { pressure: true, snapshot };
        }
        return { pressure: false, snapshot };
    }

    latestSnapshot(): MemorySnapshot | undefined {
        return this.lastSnapshot;
    }
}
