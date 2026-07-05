/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ExecutionHost: the shared per-document execution state (doc 04 §4.2 —
 * panels attach/share). Owns the current run's RowStore (fresh spill dir per
 * run, previous run disposed), the ExecutionOrchestrator, the message
 * buffer, and result-set summaries; fans events out to every attached panel
 * controller. Refusals are honest: no session → "Connect first"; already
 * executing → Busy.
 */

import * as path from "path";
import {
    QsExecutionState,
    QsMessageRow,
    QsResultSetSummary,
    QsResultsState,
    QsCellWindow,
} from "../sharedInterfaces/queryStudio";
import { DocumentSessionBinding } from "./documentSessionBinding";
import { ExecutionOrchestrator, RunResult } from "./executionOrchestrator";
import { RowStore } from "./rowStore";

export interface ExecutionHostEvents {
    onResultSetStarted(summary: QsResultSetSummary): void;
    onRowsAppended(resultSetId: string, newRowCount: number, complete: boolean): void;
    onResultSetEnded(resultSetId: string, rowCount: number, truncatedReason?: string): void;
    onMessages(messages: QsMessageRow[]): void;
    onExecutionStateChanged(): void;
}

export class ExecutionHost {
    private rowStore: RowStore | undefined;
    private orchestrator: ExecutionOrchestrator | undefined;
    private messages: QsMessageRow[] = [];
    private summaries = new Map<string, QsResultSetSummary>();
    private summaryOrder: string[] = [];
    private listeners = new Set<ExecutionHostEvents>();
    private runCounter = 0;
    private startedEpochMs: number | undefined;
    private lastResult: RunResult | undefined;
    private lastRunText: string | undefined;
    executionState: QsExecutionState = { kind: "idle" };

    constructor(
        private readonly spillRoot: string,
        private readonly binding: DocumentSessionBinding,
    ) {}

    attach(listener: ExecutionHostEvents): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private fan(step: (listener: ExecutionHostEvents) => void): void {
        for (const listener of [...this.listeners]) {
            try {
                step(listener);
            } catch {
                /* panel isolation */
            }
        }
    }

    /** Start a run. Returns immediately; progress flows via events. */
    execute(
        text: string,
        options: {
            selectionStartLine: number;
            scope: "selection" | "document";
            mode?: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan";
        },
    ): { started: boolean; reason?: string } {
        const session = this.binding.activeSession;
        if (!session) {
            return { started: false, reason: "Not connected — connect first." };
        }
        if (
            this.executionState.kind === "executing" ||
            this.executionState.kind === "cancelRequested"
        ) {
            return { started: false, reason: "A query is already executing." };
        }
        if (text.trim().length === 0) {
            return { started: false, reason: "Nothing to execute." };
        }

        // Fresh run: previous results (and spill) are released NOW.
        this.rowStore?.dispose();
        this.runCounter++;
        this.rowStore = new RowStore(path.join(this.spillRoot, `run${this.runCounter}`));
        this.messages = [];
        this.summaries.clear();
        this.summaryOrder = [];
        this.lastResult = undefined;
        this.startedEpochMs = Date.now();
        this.lastRunText = text;
        this.executionState = {
            kind: "executing",
            startedEpochMs: this.startedEpochMs,
        };
        this.binding.setExecuting(true);

        const host = this;
        this.orchestrator = new ExecutionOrchestrator(session, this.rowStore, {
            onResultSetStarted(started) {
                const summary: QsResultSetSummary = {
                    resultSetId: started.resultSetId,
                    batchOrdinal: started.batchOrdinal,
                    columnNames: started.columnNames,
                    rowCount: 0,
                    complete: false,
                    ...(started.isPlanResult ? { isPlanResult: true } : {}),
                };
                host.summaries.set(started.resultSetId, summary);
                host.summaryOrder.push(started.resultSetId);
                host.fan((l) => l.onResultSetStarted(summary));
            },
            onRowsAppended(resultSetId, newRowCount, complete) {
                const summary = host.summaries.get(resultSetId);
                if (summary) {
                    summary.rowCount += newRowCount;
                }
                host.fan((l) => l.onRowsAppended(resultSetId, newRowCount, complete));
            },
            onResultSetEnded(resultSetId, _rowCount, truncatedReason) {
                const summary = host.summaries.get(resultSetId);
                if (summary) {
                    summary.complete = true;
                    if (truncatedReason) {
                        summary.truncatedReason = truncatedReason;
                    }
                }
                host.fan((l) =>
                    l.onResultSetEnded(resultSetId, summary?.rowCount ?? 0, truncatedReason),
                );
            },
            onMessages(rows) {
                host.messages.push(...rows);
                host.fan((l) => l.onMessages(rows));
            },
            onPhase(phase) {
                if (phase === "cancelRequested") {
                    host.executionState = {
                        ...host.executionState,
                        kind: "cancelRequested",
                    };
                    host.fan((l) => l.onExecutionStateChanged());
                }
            },
        });

        void this.orchestrator
            .run(text, {
                selectionStartLine: options.selectionStartLine,
                stopOnError: false,
                scope: options.scope,
                mode: options.mode ?? "normal",
            })
            .then(
                (result) => this.finishRun(result),
                (error) => {
                    this.messages.push({
                        batchIndex: 0,
                        kind: "error",
                        text: error instanceof Error ? error.message : String(error),
                        epochMs: Date.now(),
                    });
                    this.finishRun({
                        status: "failed",
                        batches: 0,
                        resultSets: 0,
                        totalRows: 0,
                        errors: 1,
                        durationMs: Date.now() - (this.startedEpochMs ?? Date.now()),
                    });
                },
            );
        this.fan((l) => l.onExecutionStateChanged());
        return { started: true };
    }

    private finishRun(result: RunResult): void {
        this.binding.notifyExecutedBatch(
            this.lastRunText ?? "",
            result.status === "succeeded" || result.status === "completedWithErrors",
        );
        this.lastResult = result;
        this.executionState = {
            kind: result.status,
            startedEpochMs: this.startedEpochMs,
            elapsedMs: result.durationMs,
            batchCount: result.batches,
        };
        this.binding.setExecuting(false);
        this.fan((l) => l.onExecutionStateChanged());
    }

    cancel(): Promise<{ acknowledged: boolean }> {
        return this.orchestrator?.requestCancel() ?? Promise.resolve({ acknowledged: false });
    }

    getRows(resultSetId: string, start: number, count: number): QsCellWindow {
        return (
            this.rowStore?.getRows(resultSetId, start, count) ?? {
                resultSetId,
                start,
                rowCount: 0,
                columns: [],
                values: [],
            }
        );
    }

    getMessages(afterIndex?: number): { messages: QsMessageRow[] } {
        return { messages: this.messages.slice(afterIndex ?? 0) };
    }

    get lastRunResult(): RunResult | undefined {
        return this.lastResult;
    }

    /** PERF_MODE probe surface (mssql.perf.queryStudioState). */
    get spillStats(): { memoryBytes: number; spillBytes: number; resultSets: number } | undefined {
        return this.rowStore?.stats;
    }

    resultsState(): QsResultsState {
        const resultSets = this.summaryOrder
            .map((id) => this.summaries.get(id))
            .filter((s): s is QsResultSetSummary => s !== undefined);
        return {
            present: this.runCounter > 0,
            resultSets,
            totalRows: resultSets.reduce((total, s) => total + s.rowCount, 0),
            streaming: this.executionState.kind === "executing",
            messageCount: this.messages.length,
            errorCount: this.messages.filter((m) => m.kind === "error").length,
            planCount: resultSets.filter((s) => s.isPlanResult).length,
        };
    }

    /** Background catalog query: one string column, first cell per row. */
    private async backgroundColumn(sql: string): Promise<string[]> {
        const session = this.binding.activeSession;
        if (!session) {
            return [];
        }
        // Await the HANDLE (session frees its active slot via completion
        // reaction order — resolving on the sink callback races into Busy).
        const values: string[] = [];
        const handle = session.execute(
            sql,
            { priority: "background", commandKind: "metadata", tag: "queryStudio:catalog" },
            {
                onResultSetStarted: () => undefined,
                onRowsPage: (page) => {
                    for (const row of page.compact.values) {
                        if (row[0] !== undefined && row[0] !== null) {
                            values.push(String(row[0]));
                        }
                    }
                },
                onMessage: () => undefined,
                onComplete: () => undefined,
            },
        );
        await handle.completion;
        return values;
    }

    listDatabases(): Promise<string[]> {
        if (this.executionState.kind === "executing") {
            return Promise.resolve([]);
        }
        return this.backgroundColumn(
            "SELECT name FROM sys.databases WHERE state = 0 ORDER BY name;",
        ).catch(() => []);
    }

    /** USE [db]: bracket-escaped; context change flows via the session event. */
    async setDatabase(database: string): Promise<boolean> {
        const session = this.binding.activeSession;
        if (!session || this.executionState.kind === "executing") {
            return false;
        }
        const escaped = database.replace(/]/g, "]]");
        let failed = false;
        const handle = session.execute(
            `USE [${escaped}];`,
            { priority: "interactive", commandKind: "user", tag: "queryStudio:use" },
            {
                onResultSetStarted: () => undefined,
                onRowsPage: () => undefined,
                onMessage: (m) => {
                    if (m.kind === "error") {
                        failed = true;
                    }
                },
                onComplete: () => undefined,
            },
        );
        const summary = await handle.completion;
        failed = failed || summary.status !== "succeeded";
        if (!failed) {
            session.signalDatabaseChanged(database, "feature");
        }
        return !failed;
    }

    dispose(): void {
        this.rowStore?.dispose();
        this.rowStore = undefined;
        this.listeners.clear();
    }
}
