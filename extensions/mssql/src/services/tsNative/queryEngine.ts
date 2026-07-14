/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TsNativeQuery (TSQ2 addendum §5.4-5.13, §6.3): one query lifecycle over an
 * ITdsQueryLease. Owns the result-set ledger, page pipeline, bounded sink
 * lane, absolute domain deadline, cancel/dispose/loss terminals, exact-mode
 * fidelity fail-closed, backpressure (window pause), and the CPU slice
 * governor. Produces the domain QueryHandle whose `accepted` and `completion`
 * ALWAYS settle, independently of a stuck or throwing sink.
 *
 * No vscode import; observability is the injected EngineObserver port.
 */

import {
    CancelAck,
    ColumnMetadata,
    DataPlaneErrorCodes,
    ExecuteOptions,
    IQueryEventSink,
    QueryAcceptance,
    QueryCompleteSummary,
    QueryCompletionStatus,
    QueryHandle,
    ResultSetMetadata,
    RowsPage,
    ServerMessage,
    SqlDataPlaneErrorInfo,
} from "../sqlDataPlane/api";
import {
    EngineClock,
    EngineDisposable,
    EngineIds,
    ITdsQueryLease,
    TdsColumn,
    TdsCompletion,
    TdsQueryEvent,
    TdsQueryObserver,
} from "./driver/tdsDriver";
import {
    SPATIAL_TYPE_HINT_V1,
    VECTOR_TYPE_HINT_V1,
} from "../../sharedInterfaces/queryResultCellCodec";
import { BoundedEventLane } from "./boundedEventLane";
import {
    EncodePolicy,
    encodeCell,
    fidelityViolation,
    isSpatialColumn,
    typeHintForColumn,
} from "./cellEncoder";
import { PageBuilder, TS_NATIVE_PAGE_DEFAULTS, clampPageLimit } from "./pageBuilder";
import { ResultSetLedger } from "./resultSetLedger";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface EngineDeadlines {
    cancelAckMs: number;
    completeAfterCancelMs: number;
    disposeDrainMs: number;
    sinkCallbackDeadlineMs: number;
}

export const DEFAULT_ENGINE_DEADLINES: EngineDeadlines = {
    cancelAckMs: 10_000,
    completeAfterCancelMs: 30_000,
    disposeDrainMs: 10_000,
    sinkCallbackDeadlineMs: 60_000,
};

export interface EngineSlicePolicy {
    maxRowsBeforeYield: number;
    maxSynchronousMs: number;
}

export const DEFAULT_SLICE_POLICY: EngineSlicePolicy = {
    maxRowsBeforeYield: 512,
    maxSynchronousMs: 12,
};

/** Narrow observability port (real impl in observability.ts; no-op default). */
export interface EngineObserver {
    onPause?(reason: string): void;
    onResume?(reason: string): void;
    onTerminal?(summary: QueryCompleteSummary, aggregates: EngineAggregates): void;
    onDroppedAfterTerminal?(kind: string): void;
    onProtocolViolation?(observation: string): void;
}

export interface EngineAggregates {
    driverEvents: number;
    resultSets: number;
    rows: number;
    pages: number;
    logicalEncodedBytes: number;
    encodeMsTotal: number;
    sinkWaitMsTotal: number;
    pauseMsByReason: Record<string, number>;
    yields: number;
    maxSynchronousSliceMs: number;
    firstMetadataMs?: number;
    firstPageProducedMs?: number;
    firstPageAcceptedMs?: number;
}

export interface QueryEngineDeps {
    clock: EngineClock;
    ids: EngineIds;
    deadlines: EngineDeadlines;
    slice: EngineSlicePolicy;
    observer?: EngineObserver;
    /** TSQ2 §6.4 lossy preview (debug-only): mark instead of fail-closed. */
    lossyPreview?: boolean;
    /** §5.13 memory breaker — off unless configured (zero default overhead). */
    memoryBreaker?: import("./memoryBudget").MemoryBreaker;
    /** Session-negotiated struct; gates per-query typed-encoding opt-ins. */
    sessionCapabilities?: import("../sqlDataPlane/api").SqlBackendCapabilities;
    /** Forced physical teardown (dispose/cancel deadline path). */
    forceAbort: (reason: string) => void;
    onDatabaseChanged?: (database: string) => void;
    /** Active-slot release: called exactly once at terminal. */
    onTerminal: () => void;
}

type CancelCause = "user" | "timeout" | "dispose" | "sessionClose";

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class TsNativeQuery {
    readonly clientQueryId: string;
    readonly handle: QueryHandle;

    private readonly lane: BoundedEventLane;
    private readonly ledger: ResultSetLedger;
    private readonly policy: EncodePolicy;
    private readonly pageLimits = { pageRows: 0, pageBytes: 0 };
    private readonly windowPages: number;

    private lease!: ITdsQueryLease;
    private builder: PageBuilder | undefined;
    private currentColumns: readonly TdsColumn[] = [];
    private currentTypeHints: string[] = [];
    private readonly laneMaxItems: number;

    private completionResolve!: (s: QueryCompleteSummary) => void;
    private acceptedResolve!: (a: QueryAcceptance) => void;
    private acceptedSettled = false;
    private terminalSent = false;
    private fidelityError: SqlDataPlaneErrorInfo | undefined;
    private cancelCause: CancelCause | undefined;
    private cancelRequested = false;
    private disposed = false;
    private pagesInFlight = 0;
    private pausedForWindow = false;
    private errorCount = 0;
    private totalRows = 0;
    private readonly startedMs: number;
    private deadlineTimer: EngineDisposable | undefined;
    private cancelHardTimer: EngineDisposable | undefined;
    private rowsSinceYield = 0;
    private sliceStartMs: number;
    private pauseStartedMs = new Map<string, number>();
    private readonly aggregates: EngineAggregates = {
        driverEvents: 0,
        resultSets: 0,
        rows: 0,
        pages: 0,
        logicalEncodedBytes: 0,
        encodeMsTotal: 0,
        sinkWaitMsTotal: 0,
        pauseMsByReason: {},
        yields: 0,
        maxSynchronousSliceMs: 0,
    };

    constructor(
        executor: (observer: TdsQueryObserver) => ITdsQueryLease,
        _text: string, // reserved for RequestDescriptor digests (TSQ2-8)
        opts: ExecuteOptions,
        private readonly sink: IQueryEventSink,
        private readonly deps: QueryEngineDeps,
    ) {
        this.clientQueryId = deps.ids.next("tnq");
        this.startedMs = deps.clock.now();
        this.sliceStartMs = this.startedMs;
        this.pageLimits.pageRows = clampPageLimit(opts.pageRows, TS_NATIVE_PAGE_DEFAULTS.pageRows);
        this.pageLimits.pageBytes = clampPageLimit(
            opts.pageBytes,
            TS_NATIVE_PAGE_DEFAULTS.pageBytes,
        );
        const maxCellBytes = clampPageLimit(
            opts.maxCellBytes,
            TS_NATIVE_PAGE_DEFAULTS.maxCellBytes,
        );
        // Typed encodings engage only when the CALLER opted in AND the
        // session negotiated the capability (opt-in literals, STS2 parity).
        const caps = deps.sessionCapabilities;
        this.policy = {
            maxCellBytes,
            truncatedPrefixBytes: Math.min(
                TS_NATIVE_PAGE_DEFAULTS.truncatedPrefixBytes,
                maxCellBytes,
            ),
            lossyPreview: deps.lossyPreview === true,
            spatialWkb: opts.spatialEncoding === "wkb-v1" && caps?.spatialWkbV1 === true,
            vectorBinary: opts.vectorEncoding === "binary-v1" && caps?.vectorBinaryV1 === true,
        };
        this.windowPages = TS_NATIVE_PAGE_DEFAULTS.windowPages;
        this.laneMaxItems = this.windowPages * 4; // pages + interleaved messages/ends
        this.ledger = new ResultSetLedger(() => deps.ids.next("tnrs"));
        this.lane = new BoundedEventLane(
            deps.clock,
            {
                maxItems: this.laneMaxItems,
                maxBytes: this.windowPages * this.pageLimits.pageBytes * 2,
                sinkCallbackDeadlineMs: deps.deadlines.sinkCallbackDeadlineMs,
            },
            (failure) => this.onLaneFailure(failure),
        );

        const completion = new Promise<QueryCompleteSummary>((resolve) => {
            this.completionResolve = resolve;
        });
        const accepted = new Promise<QueryAcceptance>((resolve) => {
            this.acceptedResolve = resolve;
        });
        this.handle = {
            clientQueryId: this.clientQueryId,
            accepted,
            completion,
            cancel: () => this.cancel("user"),
            dispose: () => this.disposeQuery(),
        };

        // Absolute domain deadline (addendum §2.4/§5.10): extension-owned
        // monotonic timer; the driver requestTimeout is NOT the contract.
        if (opts.timeoutMs && opts.timeoutMs > 0) {
            this.deadlineTimer = deps.clock.setTimeout(() => {
                this.cancelCause ??= "timeout";
                void this.lease.cancel("timeout");
                this.armCancelHardDeadline();
            }, opts.timeoutMs);
        }

        this.lease = executor({ onEvent: (event) => this.onDriverEvent(event) });
        void this.lease.accepted.then(
            () => {
                this.settleAccepted({
                    status: "accepted",
                    clientQueryId: this.clientQueryId,
                    acceptedEpochMs: Date.now(),
                });
                if (this.sink.onAccepted) {
                    this.lane.enqueue({
                        label: "accepted",
                        bytes: 0,
                        run: () => this.sink.onAccepted?.({ clientQueryId: this.clientQueryId }),
                    });
                }
            },
            (error: unknown) => {
                this.settleAccepted({
                    status: "rejected",
                    clientQueryId: this.clientQueryId,
                    error: this.mapDriverError(error),
                });
            },
        );
        void this.lease.completed.then((completionResult) => this.finish(completionResult));
    }

    // -----------------------------------------------------------------------
    // Driver events
    // -----------------------------------------------------------------------

    private onDriverEvent(event: TdsQueryEvent): void {
        if (this.terminalSent || this.fidelityError) {
            this.deps.observer?.onDroppedAfterTerminal?.(event.kind);
            return;
        }
        this.aggregates.driverEvents++;
        switch (event.kind) {
            case "metadata":
                this.onMetadata(event.columns);
                break;
            case "row":
                this.onRow(event.cells);
                break;
            case "done": {
                const { closed } = this.ledger.onDone(event.rowCount);
                if (closed) {
                    this.flushSetEnd(closed.id, closed.rowCount, true);
                }
                break;
            }
            case "message":
                this.onMessage(event);
                break;
            case "databaseChanged":
                this.deps.onDatabaseChanged?.(event.database);
                break;
        }
    }

    private onMetadata(columns: TdsColumn[]): void {
        // Exact-mode fidelity guard (§6.3): fail BEFORE any page of this set.
        if (!this.policy.lossyPreview) {
            const violations = columns
                .map((column) => fidelityViolation(column))
                .filter((v): v is NonNullable<typeof v> => v !== undefined);
            if (violations.length > 0) {
                this.fidelityError = {
                    code: DataPlaneErrorCodes.capabilityUnsupported,
                    message:
                        `exact-mode unsupported column type(s): ` +
                        violations
                            .map((v) => `${v.columnName} (${v.typeName} → ${v.capability})`)
                            .join(", "),
                    retryable: false,
                    backend: { kind: "ts-native", code: violations[0].reasonCode },
                };
                this.cancelCause ??= "dispose";
                void this.lease.cancel("dispose");
                this.armCancelHardDeadline();
                return;
            }
        }
        if (this.aggregates.firstMetadataMs === undefined) {
            this.aggregates.firstMetadataMs = this.deps.clock.now() - this.startedMs;
        }
        const { closed, opened } = this.ledger.onMetadata(columns);
        if (closed) {
            this.flushSetEnd(closed.id, closed.rowCount, false);
        }
        this.currentColumns = columns;
        this.currentTypeHints = columns.map((column) => this.hintFor(column));
        this.builder = new PageBuilder(opened.id, this.currentTypeHints, this.pageLimits);
        this.aggregates.resultSets++;
        const meta: ResultSetMetadata = {
            resultSetId: opened.id,
            batchOrdinal: 0,
            statementOrdinal: opened.ordinal,
            columns: columns.map((column, ordinal) => this.toColumnMetadata(column, ordinal)),
        };
        this.lane.enqueue({
            label: "resultSetStarted",
            bytes: 0,
            run: () => this.sink.onResultSetStarted(meta),
        });
    }

    private onRow(cells: readonly { value: unknown; nanosecondsDelta?: number }[]): void {
        const violation = this.ledger.onRow();
        if (violation) {
            this.protocolViolation("row before result-set metadata");
            return;
        }
        const encodeStart = this.deps.clock.now();
        const values: unknown[] = [];
        const nulls: boolean[] = [];
        let rowBytes = 0;
        for (let i = 0; i < cells.length; i++) {
            const encoded = encodeCell(cells[i], this.currentColumns[i], this.policy);
            values.push(encoded.value);
            nulls.push(encoded.isNull);
            rowBytes += encoded.approxBytes;
        }
        this.aggregates.encodeMsTotal += this.deps.clock.now() - encodeStart;
        this.totalRows++;
        this.aggregates.rows++;
        this.aggregates.logicalEncodedBytes += rowBytes;
        const pages = this.builder!.addRow(values, nulls, rowBytes);
        for (const page of pages) {
            this.enqueuePage(page);
        }
        this.governSlice();
    }

    private onMessage(event: {
        message: {
            number: number;
            severity: number;
            state?: number;
            message: string;
            procedure?: string;
            lineNumber?: number;
            isError: boolean;
        };
    }): void {
        const msg = event.message;
        if (msg.isError) {
            this.errorCount++;
        }
        const serverMessage: ServerMessage = {
            kind: msg.isError ? "error" : "info",
            text: msg.message,
            number: msg.number,
            severity: msg.severity,
            ...(msg.state !== undefined ? { state: msg.state } : {}),
            ...(msg.lineNumber !== undefined ? { line: msg.lineNumber } : {}),
            ...(msg.procedure !== undefined ? { procedure: msg.procedure } : {}),
        };
        this.lane.enqueue({
            label: "message",
            bytes: 0,
            run: () => this.sink.onMessage(serverMessage),
            onSettled: () => this.maybeResume(),
        });
        // Message-flood containment (§5.7): pause at the lane budget; a hard
        // budget breach (driver un-pausable) is a typed ResourceLimit, never
        // an unbounded promise chain and never silent message drops.
        const depth = this.lane.snapshot().depth;
        if (depth >= this.laneMaxItems && !this.pausedForWindow) {
            this.pausedForWindow = true;
            this.markPause("sinkBackpressure");
            this.lease.pause("sinkBackpressure");
        }
        if (depth >= this.laneMaxItems * 8) {
            this.cancelCause ??= "dispose";
            void this.lease.cancel("dispose");
            this.emitTerminal(
                "failed",
                {
                    code: DataPlaneErrorCodes.resourceLimit,
                    message: "sink event budget exceeded (message flood)",
                    retryable: false,
                },
                true,
                "known",
            );
        }
    }

    private flushSetEnd(resultSetId: string, rowCount: number, fromDone: boolean): void {
        const page = this.builder?.flush(fromDone);
        if (page) {
            this.enqueuePage(page);
        }
        this.builder = undefined;
        if (this.sink.onResultSetEnded) {
            this.lane.enqueue({
                label: "resultSetEnded",
                bytes: 0,
                run: () => this.sink.onResultSetEnded?.({ resultSetId, rowCount }),
            });
        }
    }

    private enqueuePage(page: RowsPage): void {
        // §5.13 last-resort guard: bounded-interval sampling at page points.
        const verdict = this.deps.memoryBreaker?.check();
        if (verdict?.pressure && !this.terminalSent) {
            this.cancelCause ??= "dispose";
            void this.lease.cancel("dispose");
            this.emitTerminal(
                "failed",
                {
                    code: DataPlaneErrorCodes.resourceLimit,
                    message: `memory budget exceeded (heap+external ${verdict.snapshot ? Math.round((verdict.snapshot.heapUsedBytes + verdict.snapshot.externalBytes) / 1048576) : "?"} MiB)`,
                    retryable: false,
                },
                true,
                "known",
            );
            return;
        }
        this.aggregates.pages++;
        if (this.aggregates.firstPageProducedMs === undefined) {
            this.aggregates.firstPageProducedMs = this.deps.clock.now() - this.startedMs;
        }
        this.pagesInFlight++;
        const firstPage = this.aggregates.pages === 1;
        this.lane.enqueue({
            label: `rowsPage:${page.resultSetId}:${page.pageSeq}`,
            bytes: page.approxBytes,
            run: async () => {
                await this.sink.onRowsPage(page);
                if (firstPage && this.aggregates.firstPageAcceptedMs === undefined) {
                    this.aggregates.firstPageAcceptedMs = this.deps.clock.now() - this.startedMs;
                }
            },
            onSettled: () => {
                this.pagesInFlight--;
                this.maybeResume();
            },
        });
        if (this.pagesInFlight >= this.windowPages && !this.pausedForWindow) {
            this.pausedForWindow = true;
            this.markPause("sinkBackpressure");
            this.lease.pause("sinkBackpressure");
        }
    }

    private maybeResume(): void {
        if (
            this.pausedForWindow &&
            this.pagesInFlight <= 1 &&
            this.lane.snapshot().depth <= 1 &&
            !this.terminalSent
        ) {
            this.pausedForWindow = false;
            this.markResume("sinkBackpressure");
            this.lease.resume("sinkBackpressure");
        }
    }

    /** CPU slice governor (§5.12): bounded synchronous work between yields. */
    private governSlice(): void {
        this.rowsSinceYield++;
        const sliceMs = this.deps.clock.now() - this.sliceStartMs;
        this.aggregates.maxSynchronousSliceMs = Math.max(
            this.aggregates.maxSynchronousSliceMs,
            sliceMs,
        );
        if (
            this.rowsSinceYield >= this.deps.slice.maxRowsBeforeYield ||
            sliceMs >= this.deps.slice.maxSynchronousMs
        ) {
            this.rowsSinceYield = 0;
            this.aggregates.yields++;
            this.markPause("cpuYield");
            this.lease.pause("cpuYield");
            void this.deps.clock.yield().then(() => {
                this.sliceStartMs = this.deps.clock.now();
                this.markResume("cpuYield");
                this.lease.resume("cpuYield");
            });
        }
    }

    // -----------------------------------------------------------------------
    // Terminals
    // -----------------------------------------------------------------------

    private finish(completion: TdsCompletion): void {
        this.deadlineTimer?.dispose();
        this.cancelHardTimer?.dispose();
        const { closed } = this.ledger.onCompletion();
        if (closed && !this.fidelityError) {
            this.flushSetEnd(closed.id, closed.rowCount, false);
        }
        const { status, error, certainty, reason, synthesized } = this.classifyTerminal(completion);
        this.emitTerminal(status, error, synthesized === true, certainty, reason);
    }

    private classifyTerminal(completion: TdsCompletion): {
        status: QueryCompletionStatus;
        error?: SqlDataPlaneErrorInfo;
        certainty?: "known" | "unknown";
        reason?: "transportLost" | "cancelUncertain" | "providerAborted";
        synthesized?: boolean;
    } {
        if (this.fidelityError) {
            return { status: "failed", error: this.fidelityError, certainty: "known" };
        }
        if (completion.ok) {
            return {
                status: this.errorCount > 0 ? "completedWithErrors" : "succeeded",
                certainty: "known",
            };
        }
        const category = completion.error?.category ?? "internal";
        switch (category) {
            case "cancel": {
                if (this.cancelCause === "timeout") {
                    return {
                        status: "failed",
                        certainty: "unknown",
                        reason: "cancelUncertain",
                        error: {
                            code: DataPlaneErrorCodes.clientTimeout,
                            message: "query deadline exceeded",
                            retryable: false,
                        },
                    };
                }
                if (this.cancelCause === "dispose" || this.disposed) {
                    return { status: "disposed", certainty: "unknown", reason: "cancelUncertain" };
                }
                if (this.cancelCause === "sessionClose") {
                    // Shared conformance rule (§5.4): close of an active
                    // query is an ADAPTER-fabricated connectionLost terminal.
                    return {
                        status: "connectionLost",
                        certainty: "unknown",
                        reason: "providerAborted",
                        synthesized: true,
                        error: this.unavailableError("session closed"),
                    };
                }
                return { status: "canceled", certainty: "unknown", reason: "cancelUncertain" };
            }
            case "network":
            case "timeout":
                return {
                    status: "connectionLost",
                    certainty: "unknown",
                    reason: "transportLost",
                    error: this.unavailableError(completion.error?.message ?? "connection lost"),
                };
            case "server":
                return {
                    status: this.aggregates.resultSets > 0 ? "completedWithErrors" : "failed",
                    certainty: "known",
                    error: {
                        code: DataPlaneErrorCodes.queryFailed,
                        message: "query failed with server error",
                        retryable: false,
                        ...(completion.error?.serverDetail
                            ? { server: completion.error.serverDetail }
                            : {}),
                    },
                };
            case "protocol":
                return {
                    status: "failed",
                    certainty: "known",
                    error: {
                        code: DataPlaneErrorCodes.protocolViolation,
                        message: "driver protocol violation",
                        retryable: false,
                    },
                };
            default:
                return {
                    status: "failed",
                    certainty: "known",
                    error: {
                        code: DataPlaneErrorCodes.providerInternal,
                        message: "provider internal error",
                        retryable: true,
                    },
                };
        }
    }

    /** Session-loss path (socket died without a driver completion). */
    markLost(reason: string): void {
        this.emitTerminal(
            "connectionLost",
            this.unavailableError(reason),
            true,
            "unknown",
            "transportLost",
        );
    }

    private emitTerminal(
        status: QueryCompletionStatus,
        error: SqlDataPlaneErrorInfo | undefined,
        synthesized: boolean,
        certainty?: "known" | "unknown",
        reason?: "transportLost" | "cancelUncertain" | "providerAborted",
    ): void {
        if (this.terminalSent) {
            return;
        }
        this.terminalSent = true;
        this.deadlineTimer?.dispose();
        this.cancelHardTimer?.dispose();
        this.settleAccepted({
            status: "aborted",
            clientQueryId: this.clientQueryId,
            reason: "transport",
        });
        const summary: QueryCompleteSummary = {
            clientQueryId: this.clientQueryId,
            status,
            resultSetCount: this.aggregates.resultSets,
            totalRows: this.totalRows,
            ...(this.ledger.rowsAffected !== undefined
                ? { rowsAffected: this.ledger.rowsAffected }
                : {}),
            errorCount: this.errorCount,
            durationMs: this.deps.clock.now() - this.startedMs,
            ...(synthesized ? { synthesized: true } : {}),
            ...(certainty ? { outcomeCertainty: certainty } : {}),
            ...(reason ? { outcomeReason: reason } : {}),
            ...(error ? { error } : {}),
        };
        // completion settles NOW, independently of the sink lane (§5.9).
        this.completionResolve(summary);
        const laneStats = this.lane.snapshot();
        this.aggregates.sinkWaitMsTotal = laneStats.sinkWaitMsTotal;
        this.deps.observer?.onTerminal?.(summary, this.aggregates);
        // onComplete is best-effort after settlement.
        this.lane.enqueue({
            label: "complete",
            bytes: 0,
            run: () => this.sink.onComplete(summary),
        });
        this.deps.onTerminal();
    }

    private protocolViolation(observation: string): void {
        this.deps.observer?.onProtocolViolation?.(observation);
        this.cancelCause ??= "dispose";
        void this.lease.cancel("dispose");
        this.emitTerminal(
            "failed",
            {
                code: DataPlaneErrorCodes.protocolViolation,
                message: observation,
                retryable: false,
            },
            true,
            "known",
        );
    }

    private onLaneFailure(failure: { kind: "sinkError" | "sinkTimeout"; label: string }): void {
        this.cancelCause ??= "dispose";
        void this.lease.cancel("dispose");
        this.emitTerminal(
            "failed",
            {
                code:
                    failure.kind === "sinkError"
                        ? DataPlaneErrorCodes.sinkError
                        : DataPlaneErrorCodes.clientTimeout,
                message: `sink ${failure.kind === "sinkError" ? "threw" : "timed out"} at ${failure.label}`,
                retryable: false,
            },
            true,
            "known",
        );
    }

    // -----------------------------------------------------------------------
    // Cancel / dispose
    // -----------------------------------------------------------------------

    async cancel(cause: CancelCause = "user"): Promise<CancelAck> {
        if (this.terminalSent) {
            return { acknowledged: true };
        }
        this.cancelCause ??= cause;
        this.cancelRequested = true;
        void this.lease.cancel(cause === "sessionClose" ? "sessionClose" : "user");
        let ackTimer: EngineDisposable | undefined;
        const ackDeadline = new Promise<"deadline">((resolve) => {
            ackTimer = this.deps.clock.setTimeout(
                () => resolve("deadline"),
                this.deps.deadlines.cancelAckMs,
            );
        });
        const outcome = await Promise.race([
            this.handle.completion.then(() => "completed" as const),
            ackDeadline,
        ]);
        ackTimer?.dispose(); // leak discipline (N-I10): losers of the race die
        if (outcome === "completed") {
            return { acknowledged: true };
        }
        this.armCancelHardDeadline();
        return { acknowledged: false, uncertain: true, reason: "cancel ack deadline expired" };
    }

    private armCancelHardDeadline(): void {
        this.cancelHardTimer ??= this.deps.clock.setTimeout(() => {
            if (!this.terminalSent) {
                this.deps.forceAbort("cancel/terminal deadline expired");
                const status: QueryCompletionStatus =
                    this.cancelCause === "timeout"
                        ? "failed"
                        : this.cancelCause === "dispose"
                          ? "disposed"
                          : "canceled";
                this.emitTerminal(
                    status,
                    this.cancelCause === "timeout"
                        ? {
                              code: DataPlaneErrorCodes.clientTimeout,
                              message: "query deadline exceeded (forced abort)",
                              retryable: false,
                          }
                        : undefined,
                    true,
                    "unknown",
                    "cancelUncertain",
                );
            }
        }, this.deps.deadlines.completeAfterCancelMs);
    }

    async disposeQuery(): Promise<void> {
        if (this.terminalSent) {
            return;
        }
        this.disposed = true;
        this.cancelCause ??= "dispose";
        this.lane.stop(); // stop future sink delivery immediately
        void this.lease.cancel("dispose");
        let drainTimer: EngineDisposable | undefined;
        const drainDeadline = new Promise<"deadline">((resolve) => {
            drainTimer = this.deps.clock.setTimeout(
                () => resolve("deadline"),
                this.deps.deadlines.disposeDrainMs,
            );
        });
        const outcome = await Promise.race([
            this.handle.completion.then(() => "completed" as const),
            drainDeadline,
        ]);
        drainTimer?.dispose(); // leak discipline (N-I10)
        if (outcome === "deadline" && !this.terminalSent) {
            this.deps.forceAbort("dispose drain deadline expired");
            this.emitTerminal("disposed", undefined, true, "unknown", "providerAborted");
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Per-column hint with typed-encoding overrides (STS2 lockstep). */
    private hintFor(column: TdsColumn): string {
        if (this.policy.spatialWkb && isSpatialColumn(column)) {
            return SPATIAL_TYPE_HINT_V1;
        }
        if (this.policy.vectorBinary && column.typeName === "vector") {
            return VECTOR_TYPE_HINT_V1;
        }
        return typeHintForColumn(column);
    }

    private toColumnMetadata(column: TdsColumn, ordinal: number): ColumnMetadata {
        const type = column.typeName.toLowerCase();
        return {
            ordinal,
            name: column.name,
            displayName: column.name,
            sqlType: type,
            // Raw provider/UDT identity for capability-aware UX (TSQ2-9):
            // "geometry column present but provider can't render it" needs
            // the type name even when no typed cell is emitted.
            ...(column.udtName !== undefined ? { providerType: column.udtName } : {}),
            ...(column.precision !== undefined ? { precision: column.precision } : {}),
            ...(column.scale !== undefined ? { scale: column.scale } : {}),
            ...(column.maxLength !== undefined ? { maxLength: column.maxLength } : {}),
            ...(column.nullable !== undefined ? { allowNull: column.nullable } : {}),
            ...(type === "xml" ? { isXml: true } : {}),
            ...(this.policy.spatialWkb && isSpatialColumn(column)
                ? { spatial: { kind: column.udtName, encoding: "wkb-v1" as const } }
                : {}),
            ...(this.policy.vectorBinary && type === "vector"
                ? { vector: { transport: "binary-v1" as const } }
                : {}),
        };
    }

    private settleAccepted(acceptance: QueryAcceptance): void {
        if (this.acceptedSettled) {
            return;
        }
        this.acceptedSettled = true;
        this.acceptedResolve(acceptance);
    }

    private unavailableError(message: string): SqlDataPlaneErrorInfo {
        return {
            code: DataPlaneErrorCodes.unavailable,
            message,
            retryable: true,
            synthesized: true,
        };
    }

    private mapDriverError(error: unknown): SqlDataPlaneErrorInfo {
        const category = (error as { category?: string })?.category;
        return {
            code:
                category === "auth"
                    ? DataPlaneErrorCodes.auth
                    : category === "internal"
                      ? DataPlaneErrorCodes.providerInternal
                      : DataPlaneErrorCodes.unavailable,
            message: "execute submission failed",
            retryable: category !== "auth",
        };
    }

    private markPause(reason: string): void {
        this.pauseStartedMs.set(reason, this.deps.clock.now());
        this.deps.observer?.onPause?.(reason);
    }

    private markResume(reason: string): void {
        const started = this.pauseStartedMs.get(reason);
        if (started !== undefined) {
            this.aggregates.pauseMsByReason[reason] =
                (this.aggregates.pauseMsByReason[reason] ?? 0) + (this.deps.clock.now() - started);
            this.pauseStartedMs.delete(reason);
        }
        this.deps.observer?.onResume?.(reason);
    }

    /** Diagnostic state for status/support surfaces. */
    snapshot(): {
        clientQueryId: string;
        terminal: boolean;
        cancelRequested: boolean;
        pagesInFlight: number;
        pausedForWindow: boolean;
        aggregates: EngineAggregates;
    } {
        return {
            clientQueryId: this.clientQueryId,
            terminal: this.terminalSent,
            cancelRequested: this.cancelRequested,
            pagesInFlight: this.pagesInFlight,
            pausedForWindow: this.pausedForWindow,
            aggregates: { ...this.aggregates },
        };
    }
}
