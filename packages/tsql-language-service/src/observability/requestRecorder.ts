/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LatencySummary } from "./contracts.js";

/**
 * How long each language feature took to answer.
 *
 * The feature methods are synchronous and every one of them opens by asking the runtime for a
 * snapshot at an expected version, which makes both measurements here cheap and exact: elapsed time
 * needs no request identity to correlate, and a stale request is not inferred but observed, because
 * the runtime throws when the document has moved on.
 *
 * That throw is the reason `staleDiscarded` is a measurement rather than an estimate. The package
 * states as an invariant that a result computed against a superseded document never reaches the
 * editor; this is the count that demonstrates it was caught rather than published.
 *
 * Cancellation is deliberately absent. A cancelled request is one the editor abandoned, which is
 * knowable only to the host holding the cancellation token -- these methods return before anything
 * could observe it. A zero recorded here would be a claim the layer cannot support.
 */

/** Samples retained per method, which bounds memory while keeping a percentile meaningful. */
const defaultCapacity = 128;

interface MethodWindow {
    samples: number[];
    /** Where the next sample goes once the window is full, so the buffer stays bounded. */
    cursor: number;
    count: number;
    maximumMs: number;
    staleDiscarded: number;
}

export class RequestLatencyRecorder {
    private readonly _methods = new Map<string, MethodWindow>();

    public constructor(private readonly _capacity: number = defaultCapacity) {}

    /**
     * Times one feature call, recording it as answered or as discarded for staleness.
     *
     * Wrapping rather than bracketing so a throwing method cannot leave the measurement unrecorded,
     * which is exactly the case worth counting.
     */
    public measure<T>(method: string, operation: () => T): T {
        const window = this.windowFor(method);
        const started = performance.now();
        try {
            const result = operation();
            this.observe(window, performance.now() - started);
            return result;
        } catch (error) {
            if (isStaleDocumentError(error)) {
                window.staleDiscarded += 1;
                throw error;
            }
            // A failure still consumed time, and hiding it would make a slow error path look fast.
            this.observe(window, performance.now() - started);
            throw error;
        }
    }

    public summary(): Readonly<Record<string, LatencySummary>> {
        const result: Record<string, LatencySummary> = {};
        for (const [method, window] of this._methods) {
            if (window.count === 0 && window.staleDiscarded === 0) continue;
            const sorted = [...window.samples].sort((left, right) => left - right);
            result[method] = Object.freeze({
                count: window.count,
                p50Ms: percentile(sorted, 0.5),
                p95Ms: percentile(sorted, 0.95),
                maximumMs: window.maximumMs,
                // Not measurable from inside a synchronous call; see the note above.
                cancelled: 0,
                staleDiscarded: window.staleDiscarded,
            });
        }
        return Object.freeze(result);
    }

    public get staleDiscarded(): number {
        let total = 0;
        for (const window of this._methods.values()) total += window.staleDiscarded;
        return total;
    }

    private observe(window: MethodWindow, elapsedMs: number): void {
        window.count += 1;
        window.maximumMs = Math.max(window.maximumMs, elapsedMs);
        if (window.samples.length < this._capacity) window.samples.push(elapsedMs);
        else {
            window.samples[window.cursor] = elapsedMs;
            window.cursor = (window.cursor + 1) % this._capacity;
        }
    }

    private windowFor(method: string): MethodWindow {
        const existing = this._methods.get(method);
        if (existing) return existing;
        const created: MethodWindow = {
            samples: [],
            cursor: 0,
            count: 0,
            maximumMs: 0,
            staleDiscarded: 0,
        };
        this._methods.set(method, created);
        return created;
    }
}

/** Nearest-rank, so a reported percentile is always a sample that actually occurred. */
function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const rank = Math.ceil(fraction * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/**
 * Recognises the runtime's staleness signal.
 *
 * Matched on the message because the runtime raises a plain Error; a dedicated error type would be
 * the better shape, but changing what the runtime throws would change what callers already catch.
 */
export function isStaleDocumentError(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith("Stale document request for");
}
