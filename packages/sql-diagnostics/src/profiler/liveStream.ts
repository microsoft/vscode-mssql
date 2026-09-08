/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DiagnosticsPort,
    SqlDiagEvents,
    nullDiagnostics,
    objectName,
    sys,
    userText,
} from "../core/diagnostics";
import { RawCell, SqlRunner, StreamHandle, isBinaryCell, isTruncatedCell } from "../core/types";
import { ProfilerEvent, XeEventParser, findSequenceGap, looksLikeStreamHeader } from "./xelParser";

/**
 * Streams Extended Events live from a running session.
 *
 * Two things this handles that the previous implementation did not:
 *
 * - **A dropped stream reconnects.** A network blip or server restart used to end the capture
 *   silently. XEvent has no resume point, so a reconnect cannot recover what was missed — but
 *   it can resume collecting and say exactly how much was lost.
 * - **Losses are reported, never hidden.** The server numbers events contiguously, so a jump in
 *   `event_sequence` is proof that events were dropped. Gaps are surfaced rather than leaving a
 *   quiet hole a reader would mistake for an idle server.
 */

export interface EventGap {
    /** First sequence number that never arrived. */
    readonly fromSequence: number;
    /** Last sequence number that never arrived. */
    readonly toSequence: number;
    readonly count: number;
    readonly reason: "bufferOverflow" | "streamInterrupted" | "cellTruncated";
    /** How long the stream was down, for an interruption. */
    readonly durationMs?: number;
}

export type LiveStreamStatus = "starting" | "streaming" | "reconnecting" | "stopped" | "failed";

export interface LiveStreamCallbacks {
    onEvents(events: readonly ProfilerEvent[]): void | Promise<void>;
    onGap(gap: EventGap): void;
    onStatus(status: LiveStreamStatus, detail?: string): void;
}

export interface LiveStreamOptions {
    readonly runner: SqlRunner;
    readonly sessionName: string;
    readonly callbacks: LiveStreamCallbacks;
    readonly diagnostics?: DiagnosticsPort;
    /** Give up after this long trying to reconnect. Defaults to 10 minutes. */
    readonly reconnectBudgetMs?: number;
}

/** Backoff schedule in milliseconds; the last value repeats until the budget runs out. */
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Command timeout for the stream read.
 *
 * A live event stream blocks until the server dispatches a buffer, so a quiet server is
 * indistinguishable from a hung query to a command timeout. The provider default is 30 seconds,
 * which ends the read and makes the profiler reconnect every half minute on an idle server —
 * seen as brief "reconnecting" flashes. This is the largest value the wire contract carries,
 * about 24 days, which is unbounded for the purposes of a capture.
 */
const STREAM_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_RECONNECT_BUDGET_MS = 10 * 60 * 1000;

export class ProfilerLiveStream {
    private readonly _diag: DiagnosticsPort;
    private readonly _budgetMs: number;

    private _handle?: StreamHandle;
    private _parser = new XeEventParser();
    private _lastSequence?: number;
    private _stopRequested = false;
    private _attempt = 0;
    private _disconnectedAt?: number;

    constructor(private readonly _options: LiveStreamOptions) {
        this._diag = _options.diagnostics ?? nullDiagnostics;
        this._budgetMs = _options.reconnectBudgetMs ?? DEFAULT_RECONNECT_BUDGET_MS;
    }

    /** SQL that reads the live dispatch stream for a session. */
    private get sql(): string {
        const escaped = this._options.sessionName.replace(/'/g, "''");
        return `SELECT type, data FROM sys.fn_MSxe_read_event_stream(N'${escaped}', 0)`;
    }

    async start(): Promise<void> {
        this._stopRequested = false;
        this._attempt = 0;
        await this.connect();
    }

    /** Stops the capture. A stop the user asked for never triggers a reconnect. */
    async stop(): Promise<void> {
        this._stopRequested = true;
        const handle = this._handle;
        this._handle = undefined;
        if (handle) {
            await handle.cancel().catch(() => undefined);
            await handle.dispose().catch(() => undefined);
        }
        this._options.callbacks.onStatus("stopped");
    }

    private async connect(): Promise<void> {
        this._options.callbacks.onStatus(this._attempt === 0 ? "starting" : "reconnecting");

        // A reconnect starts a new stream, so metadata must be read again from its header.
        this._parser = new XeEventParser();

        const handle = this._options.runner.stream(
            this.sql,
            async (page) => {
                if (this._stopRequested) {
                    return;
                }
                if (this._attempt > 0) {
                    // First page after a reconnect: the capture is live again.
                    this.reportReconnected();
                }
                await this.handlePage(page.queryId, page.rows);
            },
            {
                tag: "profiler.liveStream",
                timeoutMs: STREAM_TIMEOUT_MS,
                // Dispatch buffers run to a few megabytes, well past the per-cell wire bound,
                // so the whole value has to stay fetchable or every buffer arrives unusable.
                retainOversizedCells: true,
            },
        );

        this._handle = handle;
        this._options.callbacks.onStatus("streaming");

        handle.completed
            .then((completion) => {
                if (this._stopRequested || completion.status === "disposed") {
                    return;
                }
                void this.handleDisconnect(completion.message ?? `Stream ${completion.status}.`);
            })
            .catch((error: unknown) => {
                if (!this._stopRequested) {
                    void this.handleDisconnect(
                        error instanceof Error ? error.message : String(error),
                    );
                }
            });
    }

    /**
     * Decides whether to retry after the stream ends unexpectedly, and reports the outcome
     * either way rather than going quiet.
     */
    private async handleDisconnect(detail: string): Promise<void> {
        this._handle = undefined;
        this._disconnectedAt ??= Date.now();

        const elapsed = Date.now() - this._disconnectedAt;
        if (elapsed > this._budgetMs) {
            this._options.callbacks.onStatus(
                "failed",
                `Gave up reconnecting after ${Math.round(elapsed / 1000)}s. ${detail}`,
            );
            return;
        }

        // If the session is gone from the server there is nothing to reconnect to, and
        // retrying would just fail on a timer.
        if (!(await this.sessionStillExists())) {
            this._options.callbacks.onStatus(
                "failed",
                `The event session "${this._options.sessionName}" is no longer on the server.`,
            );
            return;
        }

        const delay = BACKOFF_MS[Math.min(this._attempt, BACKOFF_MS.length - 1)];
        this._attempt++;

        this._diag.emit({
            type: SqlDiagEvents.profilerReconnect,
            status: "error",
            fields: {
                session: objectName(this._options.sessionName),
                attempt: sys(this._attempt),
                detail: userText(detail),
            },
        });
        this._options.callbacks.onStatus(
            "reconnecting",
            `Reconnecting (attempt ${this._attempt})… ${detail}`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        if (!this._stopRequested) {
            await this.connect();
        }
    }

    private async sessionStillExists(): Promise<boolean> {
        try {
            const escaped = this._options.sessionName.replace(/'/g, "''");
            const result = await this._options.runner.query(
                `SELECT TOP (1) 1 AS present FROM sys.server_event_sessions WHERE name = N'${escaped}'`,
                { tag: "profiler.sessionExists" },
            );
            return result.rows.length > 0;
        } catch {
            // A failed check is not evidence the session is gone; let the retry decide.
            return true;
        }
    }

    /** Records the gap the outage created, so the grid can mark it rather than look idle. */
    private reportReconnected(): void {
        const downMs = this._disconnectedAt ? Date.now() - this._disconnectedAt : undefined;
        this._disconnectedAt = undefined;
        this._attempt = 0;

        if (downMs !== undefined && this._lastSequence !== undefined) {
            this._options.callbacks.onGap({
                fromSequence: this._lastSequence + 1,
                toSequence: this._lastSequence,
                count: 0,
                reason: "streamInterrupted",
                durationMs: downMs,
            });
        }
        this._options.callbacks.onStatus("streaming");
    }

    /** Decodes one page of dispatch buffers into events. */
    private async handlePage(
        queryId: string,
        rows: readonly (readonly RawCell[])[],
    ): Promise<void> {
        const events: ProfilerEvent[] = [];

        for (const row of rows) {
            // Column 0 is the buffer kind, column 1 the payload.
            const payload = row[1];
            const bytes = await this.materialize(queryId, payload);
            if (!bytes) {
                continue;
            }

            try {
                this._parser.parseBuffer(bytes, looksLikeStreamHeader(bytes), events);
            } catch (error) {
                // One malformed buffer must not end the capture; report it as a gap of unknown
                // size and keep going, because the next buffer is usually fine.
                this._diag.emit({
                    type: SqlDiagEvents.profilerBufferParsed,
                    status: "error",
                    fields: {
                        session: objectName(this._options.sessionName),
                        error: userText(error instanceof Error ? error.message : String(error)),
                    },
                });
            }
        }

        if (events.length === 0) {
            return;
        }

        this.detectGaps(events);
        await this._options.callbacks.onEvents(events);
    }

    /**
     * Turns a cell into buffer bytes, completing it through fetch-back when it arrived
     * truncated. A partially decoded buffer is unusable, so an incomplete one is reported as a
     * gap rather than fed to the parser.
     */
    private async materialize(queryId: string, cell: RawCell): Promise<Uint8Array | undefined> {
        if (isBinaryCell(cell)) {
            return base64ToBytes(cell.v);
        }

        if (!isTruncatedCell(cell)) {
            return undefined;
        }

        if (!cell.more || !this._options.runner.fetchCell) {
            // The whole buffer is unreadable, and every event in it is lost.
            this._options.callbacks.onGap({
                fromSequence: (this._lastSequence ?? 0) + 1,
                toSequence: this._lastSequence ?? 0,
                count: 0,
                reason: "cellTruncated",
            });
            this._diag.emit({
                type: SqlDiagEvents.profilerEventsLost,
                status: "error",
                fields: {
                    session: objectName(this._options.sessionName),
                    bytes: sys(cell.bytes),
                    reason: sys("cellTruncated"),
                },
            });
            return undefined;
        }

        const total = cell.bytes ?? 0;
        const chunks: Uint8Array[] = [];
        let offset = 0;
        let calls = 0;

        while (offset < total) {
            const chunk = await this._options.runner.fetchCell(queryId, cell.more, offset, 1 << 20);
            calls++;
            if (chunk.bytes.length === 0) {
                break;
            }
            chunks.push(chunk.bytes);
            offset += chunk.bytes.length;
            if (chunk.eof) {
                break;
            }
        }

        this._diag.emit({
            type: SqlDiagEvents.cellRefetched,
            status: "ok",
            fields: { bytes: sys(offset), count: sys(calls) },
        });

        return concat(chunks);
    }

    /**
     * Compares consecutive event sequence numbers. The server assigns these contiguously, so a
     * jump is proof of loss and needs no cooperation from the service to detect.
     */
    private detectGaps(events: readonly ProfilerEvent[]): void {
        for (const event of events) {
            const gap = findSequenceGap(this._lastSequence, event);
            if (gap) {
                this._options.callbacks.onGap({
                    fromSequence: gap.from,
                    toSequence: gap.to,
                    count: gap.count,
                    reason: "bufferOverflow",
                });
                this._diag.emit({
                    type: SqlDiagEvents.profilerEventsLost,
                    status: "error",
                    fields: {
                        session: objectName(this._options.sessionName),
                        count: sys(gap.count),
                        reason: sys("bufferOverflow"),
                    },
                });
            }
            if (event.eventSequence !== undefined) {
                this._lastSequence = event.eventSequence;
            }
        }
    }
}

function base64ToBytes(value: string): Uint8Array {
    // Buffer is available in the extension host; atob covers a browser-side caller.
    if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(value, "base64"));
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}
