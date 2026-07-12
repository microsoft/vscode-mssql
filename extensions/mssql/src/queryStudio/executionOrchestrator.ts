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
import { parseSqlcmdScript, SqlcmdConnectStep, SqlcmdSeams } from "../sql/sqlcmdPreprocessor";
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
    /**
     * Request typed vector cells for this run (D-0019). Set from the
     * `mssql.queryStudio.vectorWorkbench.enabled` gate; the backend honors it
     * only when it negotiated `vectorBinaryV1` (else honest text fallback).
     */
    vectorEncoding?: "binary-v1";
    /** Request complete SQL geometry/geography WKB for this run (D-0020). */
    spatialEncoding?: "wkb-v1";
    /** Tuning attribution stamped on the submit marker (QO-1). */
    tuningDigest?: string;
    tuningProfileId?: string;
    /**
     * Host-run start epoch — anchors the synthesized
     * "Total execution time" message to the host's clock (SSMS parity).
     * Defaults to Date.now() at run() entry.
     */
    startedEpochMs?: number;
    /**
     * SQLCMD mode (SQLCMD_MODE_PLAN.md §3.2): text is preprocessed into a
     * step plan (setvar/$(var)/:r resolved; :on error and :connect become
     * in-loop actions). Absent = the classic path, byte-identical.
     */
    sqlcmd?: {
        seams: SqlcmdSeams;
        /**
         * Opens the :connect target session; subsequent batches run on it
         * (run-scoped, STS Query.cs parity — closed at run end). Absent =
         * :connect fails honestly.
         */
        openConnectSession?(target: {
            server: string;
            user?: string;
            password?: string;
        }): Promise<ISqlSession>;
    };
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

/** One entry of the compiled run plan (SQLCMD steps interleave with batches). */
type SqlcmdWorkItem =
    | { kind: "batch"; batch: SqlBatch }
    | { kind: "connect"; step: SqlcmdConnectStep }
    | { kind: "onError"; action: "exit" | "ignore" };

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
        // Safe vector facts mirror (D-0018/D-0019) — feeds the Vector tab's
        // cheap appliesTo sniff without any extra webview round trip.
        ...(column.vector ? { vector: column.vector } : {}),
        ...(column.spatial ? { spatial: column.spatial } : {}),
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

    /**
     * The session user batches execute on. Normally the binding session; a
     * SQLCMD :connect swaps it for the rest of the run (restored + transient
     * sessions closed in runCore's finally).
     */
    private currentSession: ISqlSession;

    constructor(
        private readonly session: ISqlSession,
        private readonly rowStore: RowStore,
        private readonly events: RunEvents,
    ) {
        this.currentSession = session;
    }

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
        const handle = await this.executeWhenFree(
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
        const selectionBase = Math.max(1, options.selectionStartLine);
        const plan = this.buildWorkPlan(text, options, selectionBase);
        const batches = plan.batches;
        Perf.marker("mssql.queryStudio.query.submit", "begin", {
            scope: options.scope,
            batchCount: batches.length,
            selection: options.scope === "selection",
            ...(options.sqlcmd ? { sqlcmd: true } : {}),
            ...(options.tuningDigest ? { tuningDigest: options.tuningDigest } : {}),
            ...(options.tuningProfileId ? { tuningProfile: options.tuningProfileId } : {}),
        });
        this.events.onPhase("executing");

        let resultSets = 0;
        let totalRows = 0;
        let errors = plan.parseFailed ? 1 : 0;
        let rowsAffectedTotal: number | undefined;
        let status: RunStatus = plan.parseFailed ? "failed" : "succeeded";
        let firstResultSeen = false;
        // :on error exit|ignore overrides the run's stop policy from the
        // point it appears (STS Query.cs onErrorAction parity).
        let stopOnError = options.stopOnError;
        const transientSessions: ISqlSession[] = [];

        try {
            let batchIndex = -1;
            for (const item of plan.work) {
                if (this.cancelRequested) {
                    status = "canceled";
                    break;
                }
                if (item.kind === "onError") {
                    stopOnError = item.action === "exit";
                    continue;
                }
                if (item.kind === "connect") {
                    const opened = await this.performSqlcmdConnect(item.step, options);
                    if (!opened) {
                        // STS parity: a failed :connect aborts the run.
                        errors++;
                        status = "failed";
                        break;
                    }
                    transientSessions.push(opened);
                    this.currentSession = opened;
                    continue;
                }
                const batch = item.batch;
                batchIndex++;
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
                    if (stopOnError || (summary.status === "failed" && this.sessionDead())) {
                        if (summary.status === "failed" && !stopOnError && !this.sessionDead()) {
                            continue;
                        }
                        break;
                    }
                }
            }
        } finally {
            // :connect scope ends with the run — restore the binding session
            // (mode-wrapper OFF batches must not land on a closed transient)
            // and close every :connect session, even on throw/cancel.
            this.currentSession = this.session;
            for (const transient of transientSessions) {
                void transient.close().catch(() => undefined);
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

    /**
     * Compile the run's work plan. Classic path: GO batches only. SQLCMD
     * path: preprocess into steps; batch steps GO-split with startLine
     * shifted into ORIGINAL-text coordinates so every existing line-mapping
     * path (Started-at messages, server error Msg lines) stays correct. A
     * parse error emits one honest error message and runs NOTHING (STS
     * parity: the whole parse fails).
     */
    private buildWorkPlan(
        text: string,
        options: RunOptions,
        selectionBase: number,
    ): { work: SqlcmdWorkItem[]; batches: SqlBatch[]; parseFailed: boolean } {
        if (!options.sqlcmd) {
            const batches = splitBatches(text);
            return {
                work: batches.map((batch) => ({ kind: "batch", batch })),
                batches,
                parseFailed: false,
            };
        }
        const preprocessStart = Date.now();
        const parsed = parseSqlcmdScript(text, options.sqlcmd.seams);
        if (parsed.kind === "parseError") {
            Perf.marker("mssql.queryStudio.sqlcmd.run", "instant", {
                steps: 0,
                batches: 0,
                setvars: 0,
                includes: 0,
                connects: 0,
                errorCode: parsed.code,
                preprocessMs: Date.now() - preprocessStart,
            });
            this.events.onMessages([
                {
                    batchIndex: -1,
                    kind: "error",
                    text: `SQLCMD error (Line ${selectionBase + parsed.line}): ${parsed.message}`,
                    epochMs: Date.now(),
                },
            ]);
            return { work: [], batches: [], parseFailed: true };
        }
        const work: SqlcmdWorkItem[] = [];
        const batches: SqlBatch[] = [];
        for (const step of parsed.steps) {
            if (step.kind === "batch") {
                for (const batch of splitBatches(step.text)) {
                    const shifted = { ...batch, startLine: batch.startLine + step.startLine };
                    work.push({ kind: "batch", batch: shifted });
                    batches.push(shifted);
                }
            } else if (step.kind === "connect") {
                work.push({ kind: "connect", step });
            } else {
                work.push({ kind: "onError", action: step.action });
            }
        }
        Perf.marker("mssql.queryStudio.sqlcmd.run", "instant", {
            steps: parsed.steps.length,
            batches: batches.length,
            setvars: parsed.stats.setvars,
            includes: parsed.stats.includes,
            connects: parsed.stats.connects,
            onError: parsed.stats.onErrors > 0,
            preprocessMs: Date.now() - preprocessStart,
        });
        return { work, batches, parseFailed: false };
    }

    /** :connect execution: open the target session or fail the run honestly. */
    private async performSqlcmdConnect(
        step: SqlcmdConnectStep,
        options: RunOptions,
    ): Promise<ISqlSession | undefined> {
        const open = options.sqlcmd?.openConnectSession;
        const fail = (detail: string): undefined => {
            // Server name is user-typed script content — fine in the
            // MESSAGES tab. Passwords never appear anywhere.
            this.events.onMessages([
                {
                    batchIndex: -1,
                    kind: "error",
                    text: `SQLCMD :connect to "${step.server}" failed: ${detail}`,
                    epochMs: Date.now(),
                },
            ]);
            return undefined;
        };
        if (!open) {
            return fail(":connect is not available in this context.");
        }
        try {
            const session = await open({
                server: step.server,
                ...(step.user !== undefined ? { user: step.user } : {}),
                ...(step.password !== undefined ? { password: step.password } : {}),
            });
            this.events.onMessages([
                {
                    batchIndex: -1,
                    kind: "info",
                    text: `Connected to ${step.server}.`,
                    epochMs: Date.now(),
                },
            ]);
            return session;
        } catch (error) {
            return fail(error instanceof Error ? error.message : String(error));
        }
    }

    private sessionDead(): boolean {
        return this.currentSession.state !== "open";
    }

    /**
     * Bounded busy retry (dogfood 2026-07-10): the session allows ONE active
     * query, and short background probes (@@TRANCOUNT/@@SPID after a run,
     * session options after connect) briefly hold the slot — a rapid F5
     * landing in that window must WAIT for the slot, not fail the run with
     * "one active query per STS2 session". Non-busy errors rethrow as-is.
     */
    private async executeWhenFree(
        text: string,
        opts: Parameters<ISqlSession["execute"]>[1],
        sink: IQueryEventSink,
        deadlineMs = 5_000,
    ): Promise<QueryHandle> {
        const startedAt = Date.now();
        for (;;) {
            try {
                return this.currentSession.execute(text, opts, sink);
            } catch (error) {
                const busy =
                    (error as { code?: string }).code === "SqlDataPlane.Busy" &&
                    Date.now() - startedAt < deadlineMs &&
                    !this.cancelRequested;
                if (!busy) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 40));
            }
        }
    }

    private async runBatch(
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
                        // Vector facts must reach the STORE columns too — the
                        // workbench service reads them from store summaries
                        // (live-run bug: dropping this made every session
                        // refuse as textFallback while the wire was binary).
                        ...(c.vector ? { vector: c.vector } : {}),
                        ...(c.spatial ? { spatial: c.spatial } : {}),
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
                // Async acceptance (QO-6): this await is the backpressure
                // point — the STS2 ack is held while the spill queue drains.
                const accepted = await rowStore.appendPage(storeId, {
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
                const reason = storeSummary?.truncatedReason;
                if (!reason || rowLimitCancelRequested) {
                    return;
                }
                rowLimitCancelRequested = true;
                const rowLimit = rowStore.stats.maxRowsPerResultSet;
                endedSets.add(page.resultSetId);
                rowStore.endResultSet(storeId, reason);
                events.onResultSetEnded(storeId, storeSummary.rowCount, reason);
                if (reason === "maxRowsPerResultSet") {
                    Perf.marker("mssql.queryStudio.rows.maxRowsPerResultSet", "instant", {
                        batchIndex,
                        resultSetId: storeId,
                        rowLimit,
                        retainedRows: storeSummary.rowCount,
                    });
                }
                events.onMessages([
                    {
                        batchIndex,
                        ...(batch.repeatTotal > 1 ? { repeatOrdinal: batch.repeatOrdinal } : {}),
                        kind: "warning",
                        text:
                            reason === "maxRowsPerResultSet"
                                ? `Query Studio reached the result row limit of ${formatInteger(rowLimit)} rows. ` +
                                  "The result set was truncated and the query was canceled. " +
                                  "Increase mssql.queryStudio.maxRowsPerResultSet to allow more rows."
                                : "Stopped because local result storage reached its configured limit. " +
                                  "The result set was truncated and the query was canceled. " +
                                  "Adjust the Query Studio tuning storage limits to allow more.",
                        epochMs: Date.now(),
                    },
                ]);
                void orchestrator.requestCancel();
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
        const handle = await this.executeWhenFree(
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
                // Typed vector cells (D-0019): gate-driven per-run opt-in.
                ...(options.vectorEncoding ? { vectorEncoding: options.vectorEncoding } : {}),
                ...(options.spatialEncoding ? { spatialEncoding: options.spatialEncoding } : {}),
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
