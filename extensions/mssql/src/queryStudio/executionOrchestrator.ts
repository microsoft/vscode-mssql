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
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    QueryHandle,
    ServerMessage,
} from "../services/sqlDataPlane/api";
import { QsMessageRow } from "../sharedInterfaces/queryStudio";
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
        const wrapper = MODE_WRAPPERS[options.mode ?? "normal"];
        if (!wrapper) {
            return this.runCore(text, options);
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
    }

    /** Fire one SET batch through a silent sink; failures surface as messages. */
    private async runSetBatch(sql: string): Promise<void> {
        const events = this.events;
        await new Promise<void>((resolve) => {
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
                onComplete: () => resolve(),
            };
            this.session.execute(
                sql,
                { priority: "interactive", commandKind: "plan", tag: "queryStudio:setWrapper" },
                sink,
            );
        });
    }

    private async runCore(text: string, options: RunOptions): Promise<RunResult> {
        const startMs = Date.now();
        const batches = splitBatches(text);
        Perf.marker("mssql.queryStudio.query.submit", "begin", {
            scope: options.scope,
            batchCount: batches.length,
            selection: options.scope === "selection",
        });
        this.events.onPhase("executing");

        let resultSets = 0;
        let totalRows = 0;
        let errors = 0;
        let rowsAffectedTotal: number | undefined;
        let status: RunStatus = "succeeded";
        let firstResultSeen = false;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            if (this.cancelRequested) {
                status = "canceled";
                break;
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
        Perf.marker("mssql.queryStudio.query.complete", "end", {
            batches: batches.length,
            resultSets,
            rows: totalRows,
            errors,
            canceled: status === "canceled",
            partial: status === "canceled" || status === "connectionLost",
            bytes: this.rowStore.stats.memoryBytes + this.rowStore.stats.spillBytes,
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
                    })),
                );
                const columnNames = meta.columns.map((c) => c.name);
                events.onResultSetStarted({
                    resultSetId: storeId,
                    batchOrdinal: batchIndex,
                    columnNames,
                    // Heuristic (diagnostics mark planDetection: heuristic):
                    // canonical single showplan-XML column.
                    isPlanResult: isPlanResultSet(columnNames),
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
                    events.onRowsAppended(storeId, page.rowCount, false);
                }
            },
            onMessage(message) {
                events.onMessages([orchestrator.toMessageRow(message, batch, batchIndex, options)]);
            },
            onResultSetEnded(info) {
                const storeId = `b${batchIndex}r${batch.repeatOrdinal}s${info.resultSetId}`;
                rowStore.endResultSet(storeId, info.truncatedReason);
                events.onResultSetEnded(storeId, info.rowCount, info.truncatedReason);
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
            },
            sink,
        );
        this.activeHandle = handle;
        return handle.completion.then((summary) => {
            // Cancel/lost truncation truthfulness: any set still open is
            // marked (partial grids never masquerade as complete).
            if (summary.status === "canceled" || summary.status === "connectionLost") {
                for (const wireId of seenSets) {
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
            }
            return summary;
        });
    }

    private toMessageRow(
        message: ServerMessage,
        batch: SqlBatch,
        batchIndex: number,
        options: RunOptions,
    ): QsMessageRow {
        const navigableLine =
            message.kind === "error"
                ? mapServerLineToDocument(options.selectionStartLine, batch.startLine, message.line)
                : undefined;
        return {
            batchIndex,
            ...(batch.repeatTotal > 1 ? { repeatOrdinal: batch.repeatOrdinal } : {}),
            kind: message.kind,
            text: message.text,
            ...(message.number !== undefined || message.severity !== undefined
                ? {
                      server: {
                          ...(message.number !== undefined ? { number: message.number } : {}),
                          ...(message.severity !== undefined ? { severity: message.severity } : {}),
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
