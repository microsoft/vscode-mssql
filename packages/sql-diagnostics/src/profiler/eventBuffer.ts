/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryAggregator } from "./aggregation";
import { EventGap } from "./liveStream";
import { ProfilerEvent } from "./xelParser";

/**
 * A bounded window of captured events, with the query aggregates kept in step.
 *
 * A profiler retains a fixed number of recent events, so something has to leave when new ones
 * arrive. Eviction is reported to the aggregator rather than left implicit, so the "top queries"
 * totals always describe exactly what is still retained instead of drifting from it.
 */
export class ProfilerEventBuffer {
    private readonly _events: ProfilerEvent[] = [];
    private readonly _gaps: EventGap[] = [];
    private readonly _aggregator = new QueryAggregator();

    /** Events discarded to stay within capacity, for an honest row count. */
    private _evicted = 0;

    constructor(private _capacity: number) {
        if (_capacity <= 0) {
            throw new Error("Capacity must be greater than zero.");
        }
    }

    get capacity(): number {
        return this._capacity;
    }

    get size(): number {
        return this._events.length;
    }

    /** How many events have been dropped from the window since the last clear. */
    get evictedCount(): number {
        return this._evicted;
    }

    get aggregator(): QueryAggregator {
        return this._aggregator;
    }

    get gaps(): readonly EventGap[] {
        return this._gaps;
    }

    /** Events in capture order, oldest first. */
    get events(): readonly ProfilerEvent[] {
        return this._events;
    }

    add(events: readonly ProfilerEvent[]): void {
        for (const event of events) {
            this._events.push(event);
            this._aggregator.add(event);
        }
        this.trim();
    }

    /**
     * Records a loss. Gaps are kept alongside the events so a reader can tell a quiet server
     * from a capture that dropped events, and so they survive into a saved capture.
     */
    addGap(gap: EventGap): void {
        this._gaps.push(gap);
    }

    /** Grows or shrinks the window, trimming immediately if it shrank. */
    setCapacity(capacity: number): void {
        if (capacity <= 0) {
            throw new Error("Capacity must be greater than zero.");
        }
        this._capacity = capacity;
        this.trim();
    }

    clear(): void {
        this._events.length = 0;
        this._gaps.length = 0;
        this._aggregator.clear();
        this._evicted = 0;
    }

    /** The most recent events, newest last, for rendering a bounded view. */
    tail(count: number): readonly ProfilerEvent[] {
        return count >= this._events.length ? this._events : this._events.slice(-count);
    }

    private trim(): void {
        const excess = this._events.length - this._capacity;
        if (excess <= 0) {
            return;
        }
        const removed = this._events.splice(0, excess);
        for (const event of removed) {
            this._aggregator.remove(event);
        }
        this._evicted += removed.length;
    }
}
