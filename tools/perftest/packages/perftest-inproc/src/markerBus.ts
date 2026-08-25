/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Marker stream the scenario engine waits on. In the orchestrated harness this
 * is fed by the control server relaying product markers; for the in-process
 * self-test it is a pure projection of the diagnostics stream (the host taps
 * `diag` and pumps every event through `deliver`). waitForMarker steps and
 * markerSeen criteria resolve here.
 */

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

    /** All markers seen so far (defensive copy). */
    all(): BusMarker[] {
        return [...this.markers];
    }

    /**
     * Resolve when a matching marker is (or was) observed. Pass `afterUnixNs`
     * for measured-interval end waits so a stale marker from before
     * scenario.start can never satisfy the wait. `isCancelled` makes the wait
     * interruptible: user cancellation must never sit behind a long timeout.
     */
    wait(
        name: string,
        attrs: Record<string, unknown> | undefined,
        timeoutMs: number,
        afterUnixNs?: string,
        isCancelled?: () => boolean,
    ): Promise<BusMarker> {
        const existing = this.find(name, attrs, afterUnixNs);
        if (existing) {
            return Promise.resolve(existing);
        }
        return new Promise<BusMarker>((resolve, reject) => {
            let cancelPoll: ReturnType<typeof setInterval> | undefined;
            if (isCancelled) {
                cancelPoll = setInterval(() => {
                    if (isCancelled()) {
                        if (cancelPoll) clearInterval(cancelPoll);
                        clearTimeout(timer);
                        this.listeners.delete(listener);
                        reject(new Error("cancelled by user"));
                    }
                }, 200);
                cancelPoll.unref?.();
            }
            const timer = setTimeout(() => {
                if (cancelPoll) clearInterval(cancelPoll);
                this.listeners.delete(listener);
                // Timeout diagnostics: say what WAS observed so a missing
                // marker is actionable, not a silent hang.
                const tail = this.markers
                    .slice(-5)
                    .map((m) => m.name)
                    .join(", ");
                const sameName = this.markers.filter((m) => m.name === name).length;
                const staleNote =
                    sameName > 0 && afterUnixNs
                        ? ` (${sameName} '${name}' marker(s) exist but predate the measured window — the marker likely cannot re-fire in this state)`
                        : "";
                reject(
                    new Error(
                        `Timed out after ${timeoutMs}ms waiting for marker '${name}'${staleNote}. ` +
                            `Last observed markers: ${tail || "(none)"} · ${this.markers.length} total on the bus`,
                    ),
                );
            }, timeoutMs);
            const listener: Listener = (marker) => {
                if (
                    marker.name === name &&
                    attrsMatch(marker, attrs) &&
                    isFresh(marker, afterUnixNs)
                ) {
                    if (cancelPoll) clearInterval(cancelPoll);
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
