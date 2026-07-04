/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Diagnostic sinks. Each sink is independently gated:
 *  - PerfModeSink:    PERF_MODE=1 (harness runs) — reproduces the exact legacy
 *                     perf-marker wire format so Phases 1-3 stay bit-compatible.
 *  - LiveTailSink:    active while a Debug Console subscribes; bounded ring
 *                     with exact gap accounting.
 *  - SessionDiagSink: user-enabled Session Diag store; JSONL segment journal
 *                     with batched, non-blocking writes.
 */

import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import {
    DiagEvent,
    GapRecord,
    SessionManifest,
    SinkHealth,
} from "../sharedInterfaces/debugConsole";
import { DiagnosticSink } from "./diagnosticsCore";

// ---------------------------------------------------------------------------
// PerfModeSink — legacy harness wire format
// ---------------------------------------------------------------------------

const PERF_MAX_QUEUE = 1000;
const PERF_FLUSH_INTERVAL_MS = 250;
const PERF_POST_TIMEOUT_MS = 2000;

interface LegacyPerfMarker {
    schemaVersion: 1;
    runId: string;
    repId: number;
    scenarioId: string;
    name: string;
    phase: string;
    correlationId?: string;
    timestampUnixNs: string;
    monotonicNs: string;
    process: { role: string; pid: number; name: string };
    attrs?: Record<string, string | number | boolean | null>;
}

/**
 * Types of diagnostic span events forwarded to the harness IN ADDITION to the
 * Perf-facade markers: JSON-RPC round-trips, webview request spans, and
 * STS-side dispatcher/SqlCommand/SMO/DacFx spans. These give CLI-run
 * waterfalls real sublane detail instead of one "doing scenario" block. The
 * names are additive to the marker vocabulary (the normalizer tolerates
 * unknown markers; importPerfRep pairs *.begin/*.end into bars).
 */
const FORWARDED_SPAN_TYPES = /^(rpc\.|webview\.|sts\.)/;

/**
 * Forwards marker-tagged diagnostics to the perf orchestrator's HTTP sink.
 * Events emitted through the Perf facade (tag "perfMarker") are relayed in the
 * exact legacy wire format; diagnostic spans matching FORWARDED_SPAN_TYPES are
 * relayed additively (tagged diag) so harness traces carry cross-process
 * detail. Everything else stays out of the harness contract.
 */
export class PerfModeSink implements DiagnosticSink {
    public readonly id = "perfMode";
    private queue: LegacyPerfMarker[] = [];
    private dropped = 0;
    private flushTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly markerUrl: string,
        private readonly token: string,
        private readonly runId: string,
        private readonly repId: number,
        private readonly scenarioId: string,
    ) {}

    public get droppedCount(): number {
        return this.dropped;
    }

    public get queuedCount(): number {
        return this.queue.length;
    }

    public health(): SinkHealth {
        return {
            id: this.id,
            healthy: this.dropped === 0,
            detail:
                this.dropped === 0
                    ? "forwarding to harness"
                    : `${this.dropped} marker(s) dropped (queue overflow or POST failure) — rep validation should flag forwarding loss`,
            counters: { queued: this.queue.length, dropped: this.dropped },
        };
    }

    public tryWrite(event: DiagEvent): void {
        const isPerfMarker = event.tags?.includes("perfMarker") === true;
        const isForwardedSpan =
            !isPerfMarker &&
            FORWARDED_SPAN_TYPES.test(event.type) &&
            !event.tags?.includes("viewerInternal");
        if (!isPerfMarker && !isForwardedSpan) {
            return;
        }
        const attrs: Record<string, string | number | boolean | null> = {};
        let hasAttrs = false;
        for (const [key, value] of Object.entries(event.payload ?? {})) {
            if (value.handling === "plain" && value.v !== undefined) {
                attrs[key] = value.v;
                hasAttrs = true;
            }
        }
        // Forwarded spans carry their duration + honest diag provenance.
        if (isForwardedSpan) {
            attrs["diag"] = true;
            hasAttrs = true;
            if (event.durationMs !== undefined) {
                attrs["durationMs"] = event.durationMs;
            }
        }
        const role =
            event.process === "webview"
                ? "webview"
                : event.process === "sqlToolsService"
                  ? "sts"
                  : "extensionHost";
        const marker: LegacyPerfMarker = {
            schemaVersion: 1,
            runId: this.runId,
            repId: this.repId,
            scenarioId: this.scenarioId,
            name: event.type,
            phase: isForwardedSpan ? forwardedPhase(event) : legacyPhase(event),
            timestampUnixNs: (BigInt(Math.round(event.epochMs)) * 1000000n).toString(),
            monotonicNs: event.monotonicNs ?? "0",
            process: {
                role,
                pid: event.process === "webview" ? 0 : (event.pid ?? process.pid),
                name: event.process === "webview" ? event.feature || "webview" : "vscode-mssql",
            },
        };
        if (hasAttrs) {
            marker.attrs = attrs;
        }
        if (event.traceId && event.tags?.includes("perfCorrelation")) {
            marker.correlationId = event.traceId;
        }
        if (this.queue.length >= PERF_MAX_QUEUE) {
            this.queue.shift();
            this.dropped++;
        }
        this.queue.push(marker);
        this.scheduleFlush();
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
                    timeout: PERF_POST_TIMEOUT_MS,
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
        }, PERF_FLUSH_INTERVAL_MS);
        this.flushTimer.unref?.();
    }
}

function legacyPhase(event: DiagEvent): string {
    if (event.tags?.includes("phase:begin")) return "begin";
    if (event.tags?.includes("phase:end")) return "end";
    if (event.tags?.includes("phase:counter")) return "counter";
    return "instant";
}

/** Forwarded diag spans: phase from the .begin/.end type suffix. */
function forwardedPhase(event: DiagEvent): string {
    if (event.type.endsWith(".begin")) return "begin";
    if (event.type.endsWith(".end")) return "end";
    return "instant";
}

// ---------------------------------------------------------------------------
// LiveTailSink — bounded ring with exact gaps
// ---------------------------------------------------------------------------

export type LiveTailListener = (events: DiagEvent[], gap?: GapRecord) => void;

export class LiveTailSink implements DiagnosticSink {
    public readonly id = "liveTail";
    private ring: DiagEvent[] = [];
    private pending: DiagEvent[] = [];
    private deliverTimer: NodeJS.Timeout | undefined;
    private listener: LiveTailListener | undefined;
    private gapCounter = 0;
    private droppedFrom: number | undefined;
    private droppedThrough: number | undefined;
    private droppedCount = 0;
    private droppedTotal = 0;

    constructor(
        private readonly ringCapacity = 5000,
        private readonly deliverIntervalMs = 120,
    ) {}

    public subscribe(listener: LiveTailListener): { snapshot: DiagEvent[]; lastSeq: number } {
        this.listener = listener;
        return {
            snapshot: [...this.ring],
            lastSeq: this.ring.length > 0 ? this.ring[this.ring.length - 1].seq : 0,
        };
    }

    public unsubscribe(): void {
        this.listener = undefined;
    }

    public tryWrite(event: DiagEvent): void {
        // Viewer-internal spans never enter the live tail: pushing the
        // console's own RPC spans back to the console re-renders it, which
        // issues more RPCs — a self-sustaining feedback loop. The archive
        // sink still retains them for the explicit "viewer internals" toggle.
        if (event.tags?.includes("viewerInternal")) {
            return;
        }
        this.ring.push(event);
        if (this.ring.length > this.ringCapacity) {
            this.ring.shift();
        }
        if (!this.listener) {
            return;
        }
        if (this.pending.length >= this.ringCapacity) {
            // Subscriber cannot keep up: drop with exact accounting.
            const dropped = this.pending.shift()!;
            this.droppedFrom = this.droppedFrom ?? dropped.seq;
            this.droppedThrough = dropped.seq;
            this.droppedCount++;
            this.droppedTotal++;
        }
        this.pending.push(event);
        if (!this.deliverTimer) {
            this.deliverTimer = setTimeout(() => {
                this.deliverTimer = undefined;
                this.deliver();
            }, this.deliverIntervalMs);
            this.deliverTimer.unref?.();
        }
    }

    private deliver(): void {
        if (!this.listener || this.pending.length === 0) {
            return;
        }
        const batch = this.pending;
        this.pending = [];
        let gap: GapRecord | undefined;
        if (this.droppedCount > 0) {
            this.gapCounter++;
            gap = {
                kind: "gap",
                gapId: `gap_live_${this.gapCounter}`,
                sessionId: batch[0].sessionId,
                fromSeq: this.droppedFrom ?? 0,
                throughSeq: this.droppedThrough ?? 0,
                droppedCount: this.droppedCount,
                reason: "subscriberOverflow",
                backfillStatus: "notStarted",
                // Exact resync point: the first event actually delivered
                // after the dropped range.
                firstAvailableSeq: batch[0].seq,
                epochMs: Date.now(),
            };
            this.droppedFrom = undefined;
            this.droppedThrough = undefined;
            this.droppedCount = 0;
        }
        try {
            this.listener(batch, gap);
        } catch {
            // listener errors never propagate to emission
        }
    }

    public health(): SinkHealth {
        return {
            id: this.id,
            healthy: this.droppedTotal === 0,
            detail:
                this.droppedTotal === 0
                    ? "live tail keeping up"
                    : `${this.droppedTotal} event(s) dropped to gaps — backfill from the session store when enabled`,
            counters: {
                ring: this.ring.length,
                pending: this.pending.length,
                droppedTotal: this.droppedTotal,
                gaps: this.gapCounter,
            },
        };
    }
}

// ---------------------------------------------------------------------------
// SessionDiagSink — JSONL segment journal
// ---------------------------------------------------------------------------

const SEGMENT_MAX_EVENTS = 5000;
const STORE_FLUSH_INTERVAL_MS = 500;
const STORE_MAX_BUFFER = 2000;

export class SessionDiagSink implements DiagnosticSink {
    public readonly id = "sessionDiag";
    private buffer: DiagEvent[] = [];
    private flushTimer: NodeJS.Timeout | undefined;
    private segmentIndex = 1;
    private segmentEvents = 0;
    private manifest: SessionManifest;
    private readonly sessionDir: string;
    private readonly eventsDir: string;
    private failed = false;
    private failureDetail = "";
    private gaps = 0;
    private sizeBytes = 0;
    private droppedRanges: Array<{ fromSeq: number; throughSeq: number }> = [];

    constructor(
        storeRoot: string,
        sessionId: string,
        captureMode: SessionManifest["captureMode"],
        policyId: string,
        provenance: SessionManifest["provenance"],
    ) {
        this.sessionDir = path.join(storeRoot, "sessions", sessionId);
        this.eventsDir = path.join(this.sessionDir, "events");
        fs.mkdirSync(this.eventsDir, { recursive: true });
        this.manifest = {
            schemaVersion: "mssql.diag.sessionManifest/1",
            sessionId,
            createdUtc: new Date().toISOString(),
            updatedUtc: new Date().toISOString(),
            source: "live",
            captureMode,
            policyId,
            eventCount: 0,
            gapCount: 0,
            segments: [{ file: "segment-000001.jsonl", firstSeq: 0, lastSeq: 0, events: 0 }],
            provenance,
            status: "active",
        };
        this.writeManifest();
    }

    public get directory(): string {
        return this.sessionDir;
    }

    public tryWrite(event: DiagEvent): void {
        if (this.failed) {
            return;
        }
        if (this.buffer.length >= STORE_MAX_BUFFER) {
            // Exact-range accounting: extend the current dropped range or
            // start a new one, so the manifest records precisely what's
            // missing (never a bare count).
            const dropped = this.buffer.shift()!;
            const last = this.droppedRanges[this.droppedRanges.length - 1];
            if (last && last.throughSeq === dropped.seq - 1) {
                last.throughSeq = dropped.seq;
            } else {
                this.droppedRanges.push({ fromSeq: dropped.seq, throughSeq: dropped.seq });
            }
            this.gaps++;
        }
        this.buffer.push(event);
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = undefined;
                this.flush();
            }, STORE_FLUSH_INTERVAL_MS);
            this.flushTimer.unref?.();
        }
    }

    public flush(): void {
        if (this.failed || this.buffer.length === 0) {
            return;
        }
        const batch = this.buffer;
        this.buffer = [];
        try {
            const segment = this.manifest.segments[this.manifest.segments.length - 1];
            const file = path.join(this.eventsDir, segment.file);
            const lines = batch.map((e) => JSON.stringify(e)).join("\n") + "\n";
            fs.appendFileSync(file, lines, "utf8");
            if (segment.firstSeq === 0) {
                segment.firstSeq = batch[0].seq;
            }
            segment.lastSeq = batch[batch.length - 1].seq;
            segment.events += batch.length;
            this.segmentEvents += batch.length;
            this.sizeBytes += Buffer.byteLength(lines, "utf8");
            this.manifest.eventCount += batch.length;
            this.manifest.gapCount = this.gaps;
            this.manifest.sizeBytes = this.sizeBytes;
            if (this.droppedRanges.length > 0) {
                this.manifest.droppedRanges = [...this.droppedRanges];
            }
            this.manifest.updatedUtc = new Date().toISOString();
            if (this.segmentEvents >= SEGMENT_MAX_EVENTS) {
                this.segmentIndex++;
                this.segmentEvents = 0;
                this.manifest.segments.push({
                    file: `segment-${String(this.segmentIndex).padStart(6, "0")}.jsonl`,
                    firstSeq: 0,
                    lastSeq: 0,
                    events: 0,
                });
            }
            this.writeManifest();
        } catch (error) {
            // Store failure disables the sink; the product must not care —
            // but the degradation is VISIBLE via health(), never silent.
            this.failed = true;
            this.failureDetail = error instanceof Error ? error.message : String(error);
        }
    }

    public health(): SinkHealth {
        return {
            id: this.id,
            healthy: !this.failed,
            detail: this.failed
                ? `store write FAILED — capture degraded (${this.failureDetail || "unknown error"})`
                : this.gaps > 0
                  ? `writing (${this.gaps} event(s) lost to buffer overflow; exact ranges in manifest)`
                  : "writing",
            counters: {
                buffered: this.buffer.length,
                eventCount: this.manifest.eventCount,
                sizeBytes: this.sizeBytes,
                droppedEvents: this.gaps,
            },
        };
    }

    public close(): void {
        this.flush();
        this.manifest.status = "closed";
        this.writeManifest();
    }

    public dispose(): void {
        this.close();
    }

    private writeManifest(): void {
        try {
            fs.writeFileSync(
                path.join(this.sessionDir, "manifest.json"),
                JSON.stringify(this.manifest, null, 2),
                "utf8",
            );
        } catch {
            this.failed = true;
        }
    }
}
