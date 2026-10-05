/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local view of the rep's marker stream: markers this driver emitted plus
 * markers relayed by the control server from other perf-mode processes
 * (product extension, STS, webviews). waitForMarker steps resolve here.
 */

import { validateTimerMs } from "./timer";

export interface BusMarker {
    name: string;
    phase: string;
    timestampUnixNs: string;
    monotonicNs?: string;
    process: { role: string; pid: number; name: string };
    attrs?: Record<string, unknown>;
}

type Listener = (marker: BusMarker) => void;

export class MarkerBus {
    private readonly markers: BusMarker[] = [];
    private readonly listeners = new Set<Listener>();

    deliver(marker: BusMarker): void {
        this.markers.push(marker);
        for (const listener of [...this.listeners]) {
            listener(marker);
        }
    }

    find(
        name: string,
        attrs?: Record<string, unknown>,
        afterUnixNs?: string,
    ): BusMarker | undefined {
        return this.markers.find(
            (m) => m.name === name && attrsMatch(m, attrs) && isFresh(m, afterUnixNs),
        );
    }

    has(name: string, attrs?: Record<string, unknown>): boolean {
        return this.find(name, attrs) !== undefined;
    }

    /**
     * Resolve when a matching marker is (or was) observed. Pass `afterUnixNs`
     * for measured-interval end waits so a stale marker from before
     * scenario.start can never satisfy the wait.
     */
    wait(
        name: string,
        attrs: Record<string, unknown> | undefined,
        timeoutMs: number,
        afterUnixNs?: string,
    ): Promise<BusMarker> {
        const safeTimeoutMs = validateTimerMs(timeoutMs, 30000, `marker '${name}' timeout`);
        const existing = this.find(name, attrs, afterUnixNs);
        if (existing) {
            return Promise.resolve(existing);
        }
        return new Promise<BusMarker>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.listeners.delete(listener);
                reject(
                    new Error(`Timed out after ${safeTimeoutMs}ms waiting for marker '${name}'`),
                );
            }, safeTimeoutMs);
            const listener: Listener = (marker) => {
                if (
                    marker.name === name &&
                    attrsMatch(marker, attrs) &&
                    isFresh(marker, afterUnixNs)
                ) {
                    clearTimeout(timer);
                    this.listeners.delete(listener);
                    resolve(marker);
                }
            };
            this.listeners.add(listener);
        });
    }
}

function isFresh(marker: BusMarker, afterUnixNs?: string): boolean {
    if (!afterUnixNs) {
        return true;
    }
    try {
        return BigInt(marker.timestampUnixNs) >= BigInt(afterUnixNs);
    } catch {
        return false;
    }
}

function attrsMatch(marker: BusMarker, attrs?: Record<string, unknown>): boolean {
    if (!attrs) {
        return true;
    }
    for (const [key, value] of Object.entries(attrs)) {
        if (marker.attrs?.[key] !== value) {
            return false;
        }
    }
    return true;
}
