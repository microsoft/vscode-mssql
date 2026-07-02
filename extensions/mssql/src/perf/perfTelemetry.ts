/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Performance-harness instrumentation. Active ONLY when the process was
 * launched by the perf orchestrator with PERF_MODE=1; otherwise every export
 * is an inert no-op and this module allocates nothing beyond a frozen stub.
 *
 * Markers are semantic perf events posted to the orchestrator's local marker
 * sink (PERF_MARKER_URL, 127.0.0.1). Writes are queued in a bounded buffer
 * and flushed asynchronously — they can be dropped under pressure but can
 * never block or throw into the product critical path.
 */

import * as http from "http";

const MAX_QUEUE = 1000;
const FLUSH_INTERVAL_MS = 250;
const POST_TIMEOUT_MS = 2000;

export type PerfMarkerPhase = "instant" | "begin" | "end" | "counter";

interface PerfMarker {
    schemaVersion: 1;
    runId: string;
    repId: number;
    scenarioId: string;
    name: string;
    phase: PerfMarkerPhase;
    correlationId?: string;
    timestampUnixNs: string;
    monotonicNs: string;
    process: { role: string; pid: number; name: string };
    attrs?: Record<string, string | number | boolean | null>;
}

export interface PerfState {
    perfMode: boolean;
    activationState: "inactive" | "activating" | "activated" | "failed";
    extensionHostPid: number;
    stsPid?: number;
    markersQueued: number;
    markersDropped: number;
}

export interface IPerfTelemetry {
    readonly enabled: boolean;
    /** Emit a semantic marker. No-op when perf mode is off. */
    marker(
        name: string,
        phase?: PerfMarkerPhase,
        attrs?: Record<string, string | number | boolean | null>,
        correlationId?: string,
    ): void;
    setActivationState(state: PerfState["activationState"]): void;
    setStsPid(pid: number | undefined): void;
    getState(): PerfState;
    /** Best-effort flush of queued markers. */
    flush(): void;
}

class NoopPerfTelemetry implements IPerfTelemetry {
    public readonly enabled = false;
    public marker(): void {}
    public setActivationState(): void {}
    public setStsPid(): void {}
    public getState(): PerfState {
        return {
            perfMode: false,
            activationState: "inactive",
            extensionHostPid: process.pid,
            markersQueued: 0,
            markersDropped: 0,
        };
    }
    public flush(): void {}
}

class ActivePerfTelemetry implements IPerfTelemetry {
    public readonly enabled = true;
    private queue: PerfMarker[] = [];
    private dropped = 0;
    private flushTimer: NodeJS.Timeout | undefined;
    private activationState: PerfState["activationState"] = "inactive";
    private stsPid: number | undefined;

    constructor(
        private readonly markerUrl: string,
        private readonly token: string,
        private readonly runId: string,
        private readonly repId: number,
        private readonly scenarioId: string,
    ) {}

    public marker(
        name: string,
        phase: PerfMarkerPhase = "instant",
        attrs?: Record<string, string | number | boolean | null>,
        correlationId?: string,
    ): void {
        try {
            const marker: PerfMarker = {
                schemaVersion: 1,
                runId: this.runId,
                repId: this.repId,
                scenarioId: this.scenarioId,
                name,
                phase,
                timestampUnixNs: (BigInt(Date.now()) * 1000000n).toString(),
                monotonicNs: process.hrtime.bigint().toString(),
                process: { role: "extensionHost", pid: process.pid, name: "vscode-mssql" },
            };
            if (attrs) {
                marker.attrs = attrs;
            }
            if (correlationId) {
                marker.correlationId = correlationId;
            }
            if (this.queue.length >= MAX_QUEUE) {
                this.queue.shift();
                this.dropped++;
            }
            this.queue.push(marker);
            this.scheduleFlush();
        } catch {
            // Instrumentation must never surface into the product.
        }
    }

    public setActivationState(state: PerfState["activationState"]): void {
        this.activationState = state;
    }

    public setStsPid(pid: number | undefined): void {
        this.stsPid = pid;
    }

    public getState(): PerfState {
        const state: PerfState = {
            perfMode: true,
            activationState: this.activationState,
            extensionHostPid: process.pid,
            markersQueued: this.queue.length,
            markersDropped: this.dropped,
        };
        if (this.stsPid !== undefined) {
            state.stsPid = this.stsPid;
        }
        return state;
    }

    public flush(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (this.queue.length === 0) {
            return;
        }
        const batch = this.queue;
        this.queue = [];
        try {
            const body = batch.map((m) => JSON.stringify(m)).join("\n");
            const request = http.request(
                this.markerUrl,
                {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-ndjson",
                        authorization: `Bearer ${this.token}`,
                    },
                    timeout: POST_TIMEOUT_MS,
                },
                (response) => response.resume(),
            );
            request.on("error", () => {
                this.dropped += batch.length;
            });
            request.on("timeout", () => request.destroy());
            request.end(body);
        } catch {
            this.dropped += batch.length;
        }
    }

    private scheduleFlush(): void {
        if (this.flushTimer) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.flush();
        }, FLUSH_INTERVAL_MS);
        // Never keep the extension host alive just to flush perf markers.
        this.flushTimer.unref?.();
    }
}

function create(): IPerfTelemetry {
    if (process.env.PERF_MODE !== "1") {
        return new NoopPerfTelemetry();
    }
    const markerUrl = process.env.PERF_MARKER_URL;
    const token = process.env.PERF_CONTROL_TOKEN;
    if (!markerUrl || !token) {
        return new NoopPerfTelemetry();
    }
    return new ActivePerfTelemetry(
        markerUrl,
        token,
        process.env.PERF_RUN_ID ?? "unknown-run",
        Number(process.env.PERF_REP_ID ?? "0"),
        process.env.PERF_SCENARIO_ID ?? "unknown-scenario",
    );
}

/**
 * The singleton perf telemetry surface. Resolved once at module load; a
 * no-op outside perf mode so call sites cost one guarded function call.
 */
export const Perf: IPerfTelemetry = create();
