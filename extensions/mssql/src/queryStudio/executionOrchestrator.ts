/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ExecutionOrchestrator (doc 04 §12): owns one execution lifecycle — batch
 * split, sequential batch loop through ISqlSession (interactive priority),
 * sink → RowStore/MessageLog fan-in, continue-on-error policy, cancel, and
 * terminal aggregation. SET wrappers (plans/parse) arrive in B4; the run
 * shape and finally-restore seams are in place.
 *
 * Run shape (§12.2): submit marker → split → per batch: execute/stream/
 * terminal → aggregate → execute end marker. The webview emits
 * resultsRendered after final paint (the official user-perceived end).
 */

import { Perf } from "../perf/perfTelemetry";
import {
    ColumnMetadata,
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    QueryHandle,
    ServerMessage,
} from "../services/sqlDataPlane/api";
import { QsMessageRow, QsResultColumn } from "../sharedInterfaces/queryStudio";
import { mapServerLineToDocument, splitBatches, SqlBatch } from "../sql/batchSplitter";
import { RowStore } from "./rowStore";

export type RunStatus =
    | "succeeded"
    | "completedWithErrors"
    | "failed"
    | "canceled"
    | "connectionLost";

export interface RunEvents {
    onResultSetStarted(summary: {
        resultSetId: string;
        batchOrdinal: number;
        columnNames: string[];
        columns?: QsResultColumn[];
        isPlanResult?: boolean;
    }): void;
    onRowsAppended(resultSetId: string, newRowCount: number, complete: boolean): void;
    onResultSetEnded(resultSetId: string, rowCount: number, truncatedReason?: string): void;
    onMessages(messages: QsMessageRow[]): void;
    onPhase(phase: "executing" | "cancelRequested" | RunStatus): void;
    onFirstResult?(msFromSubmit: number): void;
}

export interface RunOptions {
    /** 1-based document line where the executed text starts (addendum §3.4). */
    selectionStartLine: number;
    stopOnError: boolean;
    scope: "selection" | "document";
    /**
     * Execution mode (doc 04 §12.5–12.6): SET wrappers around the batch
     * loop, ALWAYS restored in finally. parse renders messages only;
     * estimatedPlan returns showplan XML result sets and runs nothing.
     */
    mode?: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan";
    /** Per-query timeout (mssql.query.executionTimeout); undefined = none. */
    timeoutMs?: number;
    /**
     * Resolved wire options from the QueryTuning snapshot (QO-1) — sent with
     * every user batch so the backend pages by the run's parameters.
     */
    wire?: { pageRows: number; pageBytes: number; maxCellBytes: number };
    /** Tuning attribution stamped on the submit marker (QO-1). */
    tuningDigest?: string;
    tuningProfileId?: string;
    /**
     * Host-run start epoch — anchors the synthesized
     * "Total execution time" message to the host's clock (SSMS parity).
     * Defaults to Date.now() at run() entry.
     */
    startedEpochMs?: number;
}

export interface RunResult {
    status: RunStatus;
    batches: number;
    resultSets: number;
    totalRows: number;
    errors: number;
    rowsAffected?: number;
    durationMs: number;
}

/** Canonical showplan XML column name (SSMS-compatible detection). */
const SHOWPLAN_COLUMN = /^Microsoft SQL Server .*XML Showplan$/i;

export function isPlanResultSet(columnNames: string[]): boolean {
    return columnNames.length === 1 && SHOWPLAN_COLUMN.test(columnNames[0] ?? "");
}

function toQsResultColumn(column: ColumnMetadata): QsResultColumn {
    return {
        name: column.name,
        displayName: column.displayName,
        ...(column.sqlType ? { sqlType: column.sqlType } : {}),
        ...(column.isXml ? { isXml: true } : {}),
        ...(column.isJson ? { isJson: true } : {}),
    };
}

const MODE_WRAPPERS: Record<string, { on: string; off: string } | undefined> = {
    normal: undefined,
    parseOnly: { on: "SET PARSEONLY ON;", off: "SET PARSEONLY OFF;" },
    estimatedPlan: { on: "SET SHOWPLAN_XML ON;", off: "SET SHOWPLAN_XML OFF;" },
    actualPlan: { on: "SET STATISTICS XML ON;", off: "SET STATISTICS XML OFF;" },
};

export class ExecutionOrchestrator {
    private cancelRequested = false;
    private activeHandle: QueryHandle | undefined;
    private messageIndex = 0;
    private cancelRequestedAt: number | undefined;
    private cancelAckMs: number | undefined;

    constructor(
        private readonly session: ISqlSession,
        private readonly rowStore: RowStore,
        private readonly events: RunEvents,
    ) {}

    requestCancel(): Promise<{ acknowledged: boolean }> {
        this.cancelRequested = true;
        this.cancelRequestedAt ??= Date.now();
        const requestedAt = this.cancelRequestedAt;
        this.events.onPhase("cancelRequested");
        const ack = this.activeHandle?.cancel() ?? Promise.resolve({ acknowledged: false });
        return ack.then((result) => {
            this.cancelAckMs ??= Date.now() - requestedAt;
            return result;
        });
    }

    async run(text: string, options: RunOptions): Promise<RunResult> {
        // Classic/SSMS message parity: the host synthesizes the run's
        // messages — the wire only carries real server messages, so a clean
        // SELECT used to leave the Messages tab empty. "Started executing
        // query at Line N" is emitted per GO batch inside runCore; the
        // closing "Total execution time" bookend is emitted here, always.
        const startedEpochMs = options.startedEpochMs ?? Date.now();
        try {
            const wrapper = MODE_WRAPPERS[options.mode ?? "normal"];
            if (!wrapper) {
                return await this.runCore(text, options);
            }
            // SET wrapper batches run OUTSIDE the user loop; the OFF side is
            // best-effort ALWAYS (finally), even after cancel/failure — the
            // session must never stay in parse/plan mode (doc 04 §12.5).
            await this.runSetBatch(wrapper.on);
            try {
                return await this.runCore(text, options);
            } finally {
                if (this.session.state === "open") {
                    await this.runSetBatch(wrapper.off).catch(() => undefined);
                }
            }
        } finally {
            this.events.onMessages([
                {
                    batchIndex: -1,
                    kind: "info",
                    text: `Total execution time: ${formatTotalExecutionTime(
                        Date.now() - startedEpochMs,
                    )}`,
                    epochMs: Date.now(),
                },
            ]);
        }
    }

    /** Fire one SET batch through a silent sink; failures surface as messages. */
    private async runSetBatch(sql: string): Promise<void> {
        const events = this.events;
        const sink: IQueryEventSink = {
            onResultSetStarted: () => undefined,
            onRowsPage: () => undefined,
            onMessage: (message) => {
                if (message.kind === "error") {
                    events.onMessages([
                        {
                            batchIndex: -1,
                            kind: "error",
                            text: message.text,
                            epochMs: Date.now(),
                        },
                    ]);
                }
            },
            onComplete: () => undefined,
        };
        const handle = this.session.execute(
            sql,
            {
                priority: "interactive",
                commandKind: "plan",
                tag: "queryStudio:setWrapper",
            },
            sink,
        );
        this.activeHandle = handle;
        await handle.completion.finally(() => {
            if (this.activeHandle === handle) {
                this.activeHandle = undefined;
            }
        });
    }

    private async runCore(text: string, options: RunOptions): Promise<RunResult> {
        const startMs = Date.now();
        const batches = splitBatches(text);
        Perf.marker("mssql.queryStudio.query.submit", "begin", {
            scope: options.scope,
            batchCount: batches.length,
            selection: options.scope === "selection",
            ...(options.tuningDigest ? { tuningDigest: options.tuningDigest } : {}),
            ...(options.tuningProfileId ? { tuningProfile: options.tuningProfileId } : {}),
        });
        this.events.onPhase("executing");

        let resultSets = 0;
        let totalRows = 0;
        let errors = 0;
        let rowsAffectedTotal: number | undefined;
        let status: RunStatus = "succeeded";
        let firstResultSeen = false;
        const selectionBase = Math.max(1, options.selectionStartLine);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            if (this.cancelRequested) {
                status = "canceled";
                break;
            }
            if (batch.repeatOrdinal === 0) {
                // SSMS parity: one "Started executing query at Line N" per GO
                // batch, N in DOCUMENT coordinates — selection offset plus the
                // batch TEXT's raw start (leading blank lines included, the
                // same anchor the server's error Line 1 points at).
                this.events.onMessages([
                    {
                        batchIndex,
                        kind: "info",
                        text: `Started executing query at Line ${
                            selectionBase + batchTextStartLine(batch)
                        }`,
                        epochMs: Date.now(),
                    },
                ]);
            }
            const summary = await this.runBatch(
                batch,
                batchIndex,
                options,
                (n) => {
                    if (!firstResultSeen) {
                        firstResultSeen = true;
                        Perf.marker("mssql.queryStudio.query.firstResult", "instant", {
                            msFromSubmit: Date.now() - startMs,
                        });
                        this.events.onFirstResult?.(Date.now() - startMs);
                    }
                    totalRows += n;
                },
                () => resultSets++,
            );
            errors += summary.errorCount;
            if (summary.rowsAffected !== undefined) {
                rowsAffectedTotal = (rowsAffectedTotal ?? 0) + summary.rowsAffected;
            }
            if (summary.status === "connectionLost") {
                status = "connectionLost";
                break;
            }
            if (summary.status === "canceled" || summary.status === "disposed") {
                status = "canceled";
                break;
            }
            if (summary.status === "failed" || summary.status === "completedWithErrors") {
                // SSMS default: continue on error; run summary reflects it.
                status = "completedWithErrors";
                if (options.stopOnError || (summary.status === "failed" && this.sessionDead())) {
                    if (
                        summary.status === "failed" &&
                        !options.stopOnError &&
                        !this.sessionDead()
                    ) {
                        continue;
                    }
                    break;
                }
            }
        }
        if (status === "succeeded" && errors > 0) {
            status = "completedWithErrors";
        }

        const durationMs = Date.now() - startMs;
        const storeStats = this.rowStore.stats;
        Perf.marker("mssql.queryStudio.query.complete", "end", {
            batches: batches.length,
            resultSets,
            rows: totalRows,
            errors,
            canceled: status === "canceled",
            partial: status === "canceled" || status === "connectionLost",
            bytes: storeStats.memoryBytes + storeStats.spillBytes,
            // Row-pipeline aggregates (QO-2): where store time went this run.
            pages: storeStats.pages,
            spillWrites: storeStats.spillWrites,
            spillReads: storeStats.spillReads,
            appendMsTotal: storeStats.appendMsTotal,
            spillWriteMsTotal: storeStats.spillWriteMsTotal,
            spillReadMsTotal: storeStats.spillReadMsTotal,
            materializeMsTotal: storeStats.materializeMsTotal,
        });
        if (this.cancelRequestedAt !== undefined) {
            Perf.marker("mssql.queryStudio.cancel", "instant", {
                msToAck: this.cancelAckMs ?? -1,
                msToTerminal: Date.now() - this.cancelRequestedAt,
            });
        }
        this.events.onPhase(status);
        return {
            status,
            batches: batches.length,
            resultSets,
            totalRows,
            errors,
            ...(rowsAffectedTotal !== undefined ? { rowsAffected: rowsAffectedTotal } : {}),
            durationMs,
        };
    }

    private sessionDead(): boolean {
        return this.session.state !== "open";
    }

    private runBatch(
        batch: SqlBatch,
        batchIndex: number,
        options: RunOptions,
        onRows: (added: number) => void,
        onResultSet: () => void,
    ): Promise<QueryCompleteSummary> {
        const events = this.events;
        const rowStore = this.rowStore;
        const orchestrator = this;
        const seenSets = new Set<string>();
        const endedSets = new Set<string>();
        const planSets = new Set<string>();
        const rowCounts = new Map<string, number>();
        let rowLimitCancelRequested = false;
        let errorMessagesSeen = 0;
        const synthesizeRowsAffected = (count: number) => {
            events.onMessages([
                {
                    batchIndex,
                    ...(batch.repeatTotal > 1 ? { repeatOrdinal: batch.repeatOrdinal } : {}),
                    kind: "info",
                    text: rowsAffectedText(count),
                    epochMs: Date.now(),
                },
            ]);
        };
        const synthesizeSummaryError = (summary: QueryCompleteSummary) => {
            if (summary.error === undefined || errorMessagesSeen > 0) {
                return;
            }
            const server = summary.error.server;
            const message: ServerMessage = {
                kind: "error",
                text: summary.error.message,
                ...(server?.number !== undefined ? { number: server.number } : {}),
                ...(server?.severity !== undefined ? { severity: server.severity } : {}),
                ...(server?.state !== undefined ? { state: server.state } : {}),
                ...(server?.line !== undefined ? { line: server.line } : {}),
                ...(server?.procedure !== undefined ? { procedure: server.procedure } : {}),
            };
            errorMessagesSeen++;
            events.onMessages([orchestrator.toMessageRow(message, batch, batchIndex, options)]);
        };
        const sink: IQueryEventSink = {
            onResultSetStarted(meta) {
                onResultSet();
                const storeId = `b${batchIndex}r${batch.repeatOrdinal}s${meta.resultSetId}`;
                seenSets.add(meta.resultSetId);
                rowStore.beginResultSet(
                    storeId,
                    meta.columns.map((c) => ({
                        name: c.name,
                        displayName: c.displayName,
                        ...(c.sqlType ? { sqlType: c.sqlType } : {}),
                        ...(c.isXml ? { isXml: true } : {}),
                        ...(c.isJson ? { isJson: true } : {}),
                    })),
                );
                const columnNames = meta.columns.map((c) => c.name);
                const columns = meta.columns.map(toQsResultColumn);
                // Heuristic (diagnostics mark planDetection: heuristic):
                // canonical single showplan-XML column.
                const isPlanResult = isPlanResultSet(columnNames);
                if (isPlanResult) {
                    planSets.add(storeId);
                }
                events.onResultSetStarted({
                    resultSetId: storeId,
                    batchOrdinal: batchIndex,
                    columnNames,
                    columns,
                    isPlanResult,
                });
            },
            async onRowsPage(page) {
                const storeId = `b${batchIndex}r${batch.repeatOrdinal}s${page.resultSetId}`;
                const accepted = rowStore.appendPage(storeId, {
                    rowOffset: page.rowOffset,
                    rowCount: page.rowCount,
                    approxBytes: page.approxBytes,
                    compact: page.compact,
                });
                if (accepted) {
                    onRows(page.rowCount);
                    rowCounts.set(
                        page.resultSetId,
                        (rowCounts.get(page.resultSetId) ?? 0) + page.rowCount,
                    );
                    events.onRowsAppended(storeId, page.rowCount, false);
                    return;
                }
                const storeSummary = rowStore.summary(storeId);
                if (
                    storeSummary?.truncatedReason === "maxRowsPerResultSet" &&
                    !rowLimitCancelRequested
                ) {
                    rowLimitCancelRequested = true;
                    const rowLimit = rowStore.stats.maxRowsPerResultSet;
                    endedSets.add(page.resultSetId);
                    rowStore.endResultSet(storeId, "maxRowsPerResultSet");
                    events.onResultSetEnded(storeId, storeSummary.rowCount, "maxRowsPerResultSet");
                    Perf.marker("mssql.queryStudio.rows.maxRowsPerResultSet", "instant", {
                        batchIndex,
                        resultSetId: storeId,
                        rowLimit,
                        retainedRows: storeSummary.rowCount,
                    });
                    events.onMessages([
                        {
                            batchIndex,
                            ...(batch.repeatTotal > 1
                                ? { repeatOrdinal: batch.repeatOrdinal }
                                : {}),
                            kind: "warning",
                            text:
                                `Query Studio reached the result row limit of ${formatInteger(rowLimit)} rows. ` +
                                "The result set was truncated and the query was canceled. " +
                                "Increase mssql.queryStudio.maxRowsPerResultSet to allow more rows.",
                            epochMs: Date.now(),
                        },
                    ]);
                    void orchestrator.requestCancel();
                }
            },
            onMessage(message) {
                if (message.kind === "error") {
                    errorMessagesSeen++;
                }
                events.onMessages([orchestrator.toMessageRow(message, batch, batchIndex, options)]);
            },
            onResultSetEnded(info) {
                if (endedSets.has(info.resultSetId)) {
                    return;
                }
                const storeId = `b${batchIndex}r${batch.repeatOrdinal}s${info.resultSetId}`;
                endedSets.add(info.resultSetId);
                rowStore.endResultSet(storeId, info.truncatedReason);
                events.onResultSetEnded(storeId, info.rowCount, info.truncatedReason);
                // Classic parity: "(N rows affected)" as each result set's
                // count completes. Skipped for plan-XML sets and for
                // truncated/cancelled sets — a clipped count printed as
                // affected rows would lie.
                if (!info.truncatedReason && !planSets.has(storeId)) {
                    synthesizeRowsAffected(info.rowCount);
                }
            },
            onComplete() {
                // Aggregation happens on the returned summary.
            },
        };
        const handle = this.session.execute(
            batch.text,
            {
                priority: "interactive",
                ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
                // Resolved tuning wire params (QO-1). The backend honors what
                // its capabilities cover (pageRows/maxCellBytes today;
                // pageBytes once QO-3 lands service-side).
                ...(options.wire
                    ? {
                          pageRows: options.wire.pageRows,
                          pageBytes: options.wire.pageBytes,
                          maxCellBytes: options.wire.maxCellBytes,
                      }
                    : {}),
            },
            sink,
        );
        this.activeHandle = handle;
        return handle.completion
            .then((summary) => {
                synthesizeSummaryError(summary);
                // Cancel/lost truncation truthfulness: any set still open is
                // marked (partial grids never masquerade as complete).
                if (summary.status === "canceled" || summary.status === "connectionLost") {
                    for (const wireId of seenSets) {
                        if (endedSets.has(wireId)) {
                            continue; // ended before the cut — its state is truthful
                        }
                        const storeId = `b${batchIndex}r${batch.repeatOrdinal}s${wireId}`;
                        rowStore.endResultSet(
                            storeId,
                            summary.status === "canceled" ? "cancelled" : "connectionLost",
                        );
                        events.onResultSetEnded(
                            storeId,
                            0,
                            summary.status === "canceled" ? "cancelled" : "connectionLost",
                        );
                    }
                } else if (seenSets.size === 0 && summary.rowsAffected !== undefined) {
                    // DML batches produce no result set — surface the summary's
                    // rowsAffected as the classic "(N rows affected)" line.
                    synthesizeRowsAffected(summary.rowsAffected);
                } else {
                    // Adapters that never emit onResultSetEnded (it's optional —
                    // the STS2 binding doesn't) left sets open at completion,
                    // which silently dropped their "(N rows affected)" lines.
                    // Close them with the orchestrator's own streamed counts.
                    for (const wireId of seenSets) {
                        if (endedSets.has(wireId)) {
                            continue;
                        }
                        const storeId = `b${batchIndex}r${batch.repeatOrdinal}s${wireId}`;
                        const rowCount = rowCounts.get(wireId) ?? 0;
                        const truncatedReason = rowStore.summary(storeId)?.truncatedReason;
                        rowStore.endResultSet(storeId);
                        events.onResultSetEnded(storeId, rowCount, truncatedReason);
                        // Same skip rules as the sink path: never print a plan
                        // set's count or a row-capped (clipped) count as
                        // "rows affected".
                        if (!truncatedReason && !planSets.has(storeId)) {
                            synthesizeRowsAffected(rowCount);
                        }
                    }
                }
                return summary;
            })
            .finally(() => {
                if (this.activeHandle === handle) {
                    this.activeHandle = undefined;
                }
            });
    }

    private toMessageRow(
        message: ServerMessage,
        batch: SqlBatch,
        batchIndex: number,
        options: RunOptions,
    ): QsMessageRow {
        const selectionBase = Math.max(1, options.selectionStartLine);
        // Server error lines are relative to the batch TEXT as submitted
        // (leading blank lines included) — anchor at the raw text start.
        // Without a server line, fall back to the first statement line.
        const navigableLine =
            message.kind === "error"
                ? mapServerLineToDocument(
                      selectionBase,
                      message.line && message.line > 0
                          ? batchTextStartLine(batch)
                          : batch.startLine,
                      message.line,
                  )
                : undefined;
        // SSMS parity: server errors render as the classic two-line block —
        // "Msg N, Level L, State S, Line D" (document-mapped line) above the
        // message text. The v2 wire doesn't carry state yet, so default it to
        // 1 (SQL Server's default state) until the notification grows one.
        const text =
            message.kind === "error" && message.number !== undefined && navigableLine !== undefined
                ? `Msg ${message.number}, Level ${message.severity ?? 0}, State ${
                      message.state ?? 1
                  }, Line ${navigableLine}\n${message.text}`
                : message.text;
        return {
            batchIndex,
            ...(batch.repeatTotal > 1 ? { repeatOrdinal: batch.repeatOrdinal } : {}),
            kind: message.kind,
            text,
            ...(message.number !== undefined || message.severity !== undefined
                ? {
                      server: {
                          ...(message.number !== undefined ? { number: message.number } : {}),
                          ...(message.severity !== undefined ? { severity: message.severity } : {}),
                          ...(message.state !== undefined ? { state: message.state } : {}),
                          ...(message.line !== undefined ? { line: message.line } : {}),
                      },
                  }
                : {}),
            epochMs: Date.now(),
            ...(navigableLine !== undefined
                ? { navigable: { line: navigableLine, column: 1 } }
                : {}),
        };
    }

    get nextMessageIndex(): number {
        return this.messageIndex++;
    }
}

/** SSMS/classic wording: "(1 row affected)" / "(N rows affected)". */
function rowsAffectedText(count: number): string {
    return `(${count} row${count === 1 ? "" : "s"} affected)`;
}

function formatInteger(count: number): string {
    return count.toLocaleString("en-US");
}

/**
 * 0-based line where a batch's TEXT begins within the executed text. The
 * splitter's startLine points at the first non-blank line, but the text sent
 * to the server keeps its leading blank lines — so the server's "Line 1"
 * (and SSMS's "Started executing query at Line N") anchor is startLine minus
 * those leading blanks.
 */
function batchTextStartLine(batch: SqlBatch): number {
    const lines = batch.text.split("\n");
    let blanks = 0;
    while (blanks < lines.length && lines[blanks].trim().length === 0) {
        blanks++;
    }
    return Math.max(0, batch.startLine - blanks);
}

/** SSMS/classic "Total execution time" format: HH:MM:SS.mmm. */
export function formatTotalExecutionTime(ms: number): string {
    const clamped = Math.max(0, Math.floor(ms));
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const hours = Math.floor(clamped / 3_600_000);
    const minutes = Math.floor(clamped / 60_000) % 60;
    const seconds = Math.floor(clamped / 1000) % 60;
    const millis = String(clamped % 1000).padStart(3, "0");
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${millis}`;
}
