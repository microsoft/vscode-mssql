/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sliced diagnostics scheduler (design 05 §6.4, §11.3): ~300ms debounce after
 * a change, whole-document passes sliced into small time budgets with a yield
 * between slices, and stale-version cancellation — a new edit (or metadata
 * generation change: the snapshot stamp encodes both) abandons the in-flight
 * pass, reporting the cancel through `onStaleCancel` so the host can count
 * drift cancels (`metadataStale`, cache/drift addendum §7.3). Per document;
 * the Query Studio facade owns one instance.
 *
 * Lives in host/** but stays vscode-free (timers only) so the unit lane can
 * drive it deterministically.
 */

import { DiagnosticsResult } from "../api";

/** A resumable pass produced by the engine (span lifecycle included). */
export interface SlicedDiagnosticsPass {
    /** Run one work unit; returns true while more work remains. */
    step(): boolean;
    /** Complete the pass and return its result. */
    finish(): DiagnosticsResult;
    /** Abandon the pass (stale version); must release any span. */
    abort(): void;
}

export interface DiagnosticsSnapshot {
    readonly text: string;
    readonly version: number;
    /**
     * Staleness stamp — typically `${version}:${metadataGeneration}`. A pass
     * aborts when the current stamp no longer equals the stamp it started
     * with; a debounce fire is skipped when an identical-stamp run is active.
     */
    readonly stamp: string;
}

export interface SlicedDiagnosticsSchedulerOptions {
    /** Current document snapshot; undefined = nothing to analyze. */
    readonly snapshot: () => DiagnosticsSnapshot | undefined;
    /**
     * Pass factory. MAY be async (CACHE-5: the host resolves the metadata
     * freshness verdict first); staleness is re-checked after the await, so
     * a slow factory can never start work against an outdated snapshot.
     */
    readonly createPass: (
        text: string,
        version: number,
    ) => SlicedDiagnosticsPass | Promise<SlicedDiagnosticsPass>;
    readonly publish: (result: DiagnosticsResult, version: number) => void;
    /**
     * Fired when an in-flight pass is abandoned as stale (never on dispose).
     * `started` is the snapshot the pass ran against, `current` the snapshot
     * at cancel time — the host tells drift cancels apart from edit cancels
     * with {@link isMetadataDriftCancel} and counts `metadataStale` (§7.3).
     */
    readonly onStaleCancel?: (
        started: DiagnosticsSnapshot,
        current: DiagnosticsSnapshot | undefined,
    ) => void;
    /** Debounce after change; design target 300ms. */
    readonly debounceMs?: number;
    /** Per-slice time budget; design target 8ms. */
    readonly sliceBudgetMs?: number;
    /** Yield between slices (test seam); default: macrotask via setTimeout 0. */
    readonly yieldSlice?: () => Promise<void>;
    readonly now?: () => number;
}

export type DiagnosticsSchedulerState = "idle" | "debouncing" | "running";

/**
 * True when a stale-cancel was caused by metadata drift: the document
 * version is unchanged but the stamp (which also encodes the metadata
 * generation) moved — i.e. a drift trigger invalidated the pass mid-flight.
 * Edit cancels (version moved) and route/setting cancels (stamp unchanged)
 * are NOT drift.
 */
export function isMetadataDriftCancel(
    started: DiagnosticsSnapshot,
    current: DiagnosticsSnapshot | undefined,
): boolean {
    return (
        current !== undefined &&
        current.version === started.version &&
        current.stamp !== started.stamp
    );
}

export class SlicedDiagnosticsScheduler {
    private readonly options: SlicedDiagnosticsSchedulerOptions;
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private running = false;
    private runningStamp: string | undefined;
    private generation = 0;
    private disposed = false;
    private published: number | undefined;

    constructor(options: SlicedDiagnosticsSchedulerOptions) {
        this.options = options;
    }

    get state(): DiagnosticsSchedulerState {
        if (this.running) {
            return "running";
        }
        return this.debounceTimer !== undefined ? "debouncing" : "idle";
    }

    get lastPublishedVersion(): number | undefined {
        return this.published;
    }

    /** Restart the debounce window; coalesces bursts of changes into one pass. */
    notifyChange(): void {
        if (this.disposed) {
            return;
        }
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            void this.run();
        }, this.options.debounceMs ?? 300);
    }

    /** Bypass the debounce and run immediately (initial seed, tests). */
    runNow(): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        return this.run();
    }

    /** Cancel any pending debounce and abandon an in-flight pass. */
    cancel(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        this.generation++; // in-flight run sees the bump and aborts
    }

    dispose(): void {
        this.disposed = true;
        this.cancel();
    }

    private async run(): Promise<void> {
        const snapshot = this.options.snapshot();
        if (snapshot === undefined) {
            return;
        }
        if (this.running && this.runningStamp === snapshot.stamp) {
            return; // an identical run is already in flight
        }
        this.generation++;
        const generation = this.generation;
        const now = this.options.now ?? ((): number => Date.now());
        const yieldSlice =
            this.options.yieldSlice ??
            ((): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0)));
        const budget = this.options.sliceBudgetMs ?? 8;

        // Abandon a stale pass; reports the cancel (unless disposing) so the
        // host can count drift cancels (metadataStale, §7.3). Returns true
        // when the pass was aborted.
        const abortIfStale = (pass: SlicedDiagnosticsPass): boolean => {
            if (this.disposed || generation !== this.generation) {
                pass.abort();
                if (!this.disposed) {
                    this.options.onStaleCancel?.(snapshot, this.options.snapshot());
                }
                return true;
            }
            const current = this.options.snapshot();
            if (current === undefined || current.stamp !== snapshot.stamp) {
                pass.abort();
                this.options.onStaleCancel?.(snapshot, current);
                return true;
            }
            return false;
        };

        // Mark running BEFORE the (possibly async) factory so identical-stamp
        // runs coalesce across the await as well.
        this.running = true;
        this.runningStamp = snapshot.stamp;
        try {
            const pass = await this.options.createPass(snapshot.text, snapshot.version);
            // The factory may have awaited (freshness verdict) — re-check.
            if (abortIfStale(pass)) {
                return;
            }
            let more = true;
            while (more) {
                const sliceEnd = now() + budget;
                do {
                    more = pass.step();
                } while (more && now() < sliceEnd);
                if (!more) {
                    break;
                }
                await yieldSlice();
                if (abortIfStale(pass)) {
                    return;
                }
            }
            const result = pass.finish();
            if (!this.disposed && generation === this.generation) {
                this.published = snapshot.version;
                this.options.publish(result, snapshot.version);
            }
        } finally {
            if (this.runningStamp === snapshot.stamp) {
                this.running = false;
                this.runningStamp = undefined;
            }
        }
    }
}
