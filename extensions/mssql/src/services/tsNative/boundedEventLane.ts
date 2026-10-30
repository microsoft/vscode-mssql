/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * BoundedEventLane (TSQ2 addendum §5.7/§5.9): one serialized sink lane per
 * query. Exactly one callback in flight; every callback (including
 * synchronous ones) is wrapped; a sink throw or deadline breach is CONTAINED
 * — the lane stops, the failure is reported, and the query's completion
 * settles independently of a stuck sink promise.
 *
 * Budgets are count+bytes; the engine reserves before enqueue and pauses the
 * driver when reservation fails (the four-page window is a MAXIMUM, not a
 * license to buffer arbitrarily).
 */

import { EngineClock } from "./driver/tdsDriver";

export interface LaneLimits {
    maxItems: number;
    maxBytes: number;
    sinkCallbackDeadlineMs: number;
}

export interface LaneFailure {
    kind: "sinkError" | "sinkTimeout";
    label: string;
    error?: unknown;
}

export interface LaneStats {
    depth: number;
    queuedBytes: number;
    highWaterItems: number;
    highWaterBytes: number;
    delivered: number;
    sinkWaitMsTotal: number;
    droppedAfterStop: number;
}

interface LaneItem {
    label: string;
    bytes: number;
    run: () => void | Promise<void>;
    /** Called after the item settles/times out and its budget is released. */
    onSettled?: () => void;
}

export class BoundedEventLane {
    private queue: LaneItem[] = [];
    private inFlight = false;
    private stopped = false;
    private failed: LaneFailure | undefined;
    private queuedBytes = 0;
    private drainWaiters: (() => void)[] = [];
    private readonly stats: LaneStats = {
        depth: 0,
        queuedBytes: 0,
        highWaterItems: 0,
        highWaterBytes: 0,
        delivered: 0,
        sinkWaitMsTotal: 0,
        droppedAfterStop: 0,
    };

    constructor(
        private readonly clock: EngineClock,
        private readonly limits: LaneLimits,
        private readonly onFailure: (failure: LaneFailure) => void,
    ) {}

    get failure(): LaneFailure | undefined {
        return this.failed;
    }

    snapshot(): LaneStats {
        return { ...this.stats, depth: this.queue.length, queuedBytes: this.queuedBytes };
    }

    /** Budget check WITHOUT reservation side effects. */
    hasCapacity(bytes: number): boolean {
        return (
            !this.stopped &&
            this.queue.length < this.limits.maxItems &&
            this.queuedBytes + bytes <= this.limits.maxBytes
        );
    }

    /**
     * Enqueue one sink callback. Caller is responsible for pausing the driver
     * when hasCapacity() said no — enqueue itself never drops silently and
     * never throws; over-budget enqueues are allowed only for terminal/system
     * items (bytes 0).
     */
    enqueue(item: LaneItem): void {
        if (this.stopped) {
            this.stats.droppedAfterStop++;
            item.onSettled?.();
            return;
        }
        this.queue.push(item);
        this.queuedBytes += item.bytes;
        this.stats.highWaterItems = Math.max(this.stats.highWaterItems, this.queue.length);
        this.stats.highWaterBytes = Math.max(this.stats.highWaterBytes, this.queuedBytes);
        void this.pump();
    }

    /** Stop delivering (dispose/containment). Queued items settle their
     *  budget callbacks but never run. */
    stop(): void {
        this.stopped = true;
        const dropped = this.queue.splice(0);
        this.queuedBytes = 0;
        for (const item of dropped) {
            this.stats.droppedAfterStop++;
            item.onSettled?.();
        }
        this.notifyDrainedIfIdle();
    }

    /** Resolves when the queue is empty and nothing is in flight. */
    drained(): Promise<void> {
        if (this.queue.length === 0 && !this.inFlight) {
            return Promise.resolve();
        }
        return new Promise((resolve) => this.drainWaiters.push(resolve));
    }

    private async pump(): Promise<void> {
        if (this.inFlight || this.stopped) {
            return;
        }
        const item = this.queue.shift();
        if (!item) {
            this.notifyDrainedIfIdle();
            return;
        }
        this.inFlight = true;
        this.queuedBytes -= item.bytes;
        const started = this.clock.now();
        let settled = false;
        const settle = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            this.stats.sinkWaitMsTotal += this.clock.now() - started;
            this.stats.delivered++;
            item.onSettled?.();
            this.inFlight = false;
            void this.pump();
        };
        const deadline = this.clock.setTimeout(() => {
            if (!settled) {
                settled = true;
                this.stats.sinkWaitMsTotal += this.clock.now() - started;
                item.onSettled?.();
                this.failLane({ kind: "sinkTimeout", label: item.label });
            }
        }, this.limits.sinkCallbackDeadlineMs);
        try {
            await item.run();
            deadline.dispose();
            settle();
        } catch (error) {
            deadline.dispose();
            if (!settled) {
                settled = true;
                item.onSettled?.();
                this.failLane({ kind: "sinkError", label: item.label, error });
            }
        }
    }

    private failLane(failure: LaneFailure): void {
        if (this.failed) {
            return;
        }
        this.failed = failure;
        this.inFlight = false;
        this.stop();
        this.onFailure(failure);
    }

    private notifyDrainedIfIdle(): void {
        if (this.queue.length === 0 && !this.inFlight) {
            for (const waiter of this.drainWaiters.splice(0)) {
                waiter();
            }
        }
    }
}
