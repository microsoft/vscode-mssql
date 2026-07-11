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

import * as crypto from "crypto";
import * as path from "path";
import {
    QsExecutionState,
    QsMessageRow,
    QsResultSetSummary,
    QsResultsState,
    QsCellWindow,
} from "../sharedInterfaces/queryStudio";
import { RetainedRowStore } from "../queryResults/resultStoreLease";
import { resolveQueryResultsParams } from "../queryResults/queryResultsParams";
import { ensureSpillSessionLock, runSpillDirName } from "../queryResults/spillHygiene";
import { FeatureReplayTags } from "../sharedInterfaces/featureReplay";
import { QueryTuningOverrides, QueryTuningSnapshot } from "../sharedInterfaces/queryTuning";
import { DocumentSessionBinding } from "./documentSessionBinding";
import { ExecutionOrchestrator, RunResult } from "./executionOrchestrator";
import { beginRunRecord, completeRunRecord } from "./replay/qsRunCapture";
import { resolveQueryTuning } from "./tuning/queryTuningResolver";
import { RowReadReason, RowStore, RowStoreLimits, RowStoreTuning } from "./rowStore";

export interface ExecutionHostEvents {
    onRunStarted?(startedEpochMs: number): void;
    onResultSetStarted(summary: QsResultSetSummary): void;
    onRowsAppended(resultSetId: string, newRowCount: number, complete: boolean): void;
    onResultSetEnded(resultSetId: string, rowCount: number, truncatedReason?: string): void;
    onMessages(messages: QsMessageRow[]): void;
    onExecutionStateChanged(): void;
}

export class ExecutionHost {
    private rowStore: RowStore | undefined;
    /** Lease-owning wrapper (C2D-1): snapshots outlive the live run. */
    private retained: RetainedRowStore | undefined;
    private orchestrator: ExecutionOrchestrator | undefined;
    private messages: QsMessageRow[] = [];
    private summaries = new Map<string, QsResultSetSummary>();
    private summaryOrder: string[] = [];
    private listeners = new Set<ExecutionHostEvents>();
    private runCounter = 0;
    private startedEpochMs: number | undefined;
    private lastResult: RunResult | undefined;
    private lastRunText: string | undefined;
    private activeRunRecordId: string | undefined;
    /** Latest execute that arrived mid-run; starts when the run settles. */
    private pendingRerun:
        | { text: string; options: Parameters<ExecutionHost["execute"]>[1] }
        | undefined;
    /** One-shot production-confirmation bypass for the confirmed re-entry. */
    private productionConfirmedOnce = false;
    private msToFirstResult: number | undefined;
    private lastTuning: QueryTuningSnapshot | undefined;
    executionState: QsExecutionState = { kind: "idle" };

    /** The active/last run's resolved QueryTuning snapshot (QO-7 consumers). */
    get currentTuning(): QueryTuningSnapshot | undefined {
        return this.lastTuning;
    }

    constructor(
        private readonly spillRoot: string,
        private readonly binding: DocumentSessionBinding,
        private readonly uriKey: string = "",
        /**
         * Production-safety guard (injected — this module stays vscode-free):
         * shouldConfirm decides from settings + group facts + SQL contents +
         * per-session suppression; confirm shows the modal.
         */
        private readonly productionGuard?: {
            shouldConfirm(text: string): boolean;
            confirm(): Promise<"yes" | "yesSession" | "no">;
        },
    ) {
        // Crash-safe spill hygiene (C2D-1): heartbeat this session's lock so
        // a startup sweep in a later session can reclaim orphaned run dirs.
        ensureSpillSessionLock(path.dirname(spillRoot));
    }

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

    /**
     * Start a run. Returns immediately; progress flows via events.
     *
     * SSMS-parity restart (dogfood 2026-07-10): executing while a run is
     * active CANCELS it and QUEUES this request — when the canceled run
     * reaches its terminal state the queued run starts (latest request
     * wins under key repeat). Never a "busy" error at the user's F5.
     */
    execute(
        text: string,
        options: {
            selectionStartLine: number;
            scope: "selection" | "document";
            mode?: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan";
            /** Per-query timeout (mssql.query.executionTimeout), host-resolved. */
            timeoutMs?: number;
            /** Highest-precedence QueryTuning overrides for THIS run (replay/experiments). */
            tuningOverrides?: QueryTuningOverrides;
            /** Present when this run is a replay-engine re-execution. */
            replayTags?: FeatureReplayTags;
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
            this.pendingRerun = { text, options };
            void this.cancel();
            return {
                started: false,
                reason: "Restarting — canceling the running query first.",
            };
        }
        if (text.trim().length === 0) {
            return { started: false, reason: "Nothing to execute." };
        }
        // Production-safety pause (Karl 2026-07-10): a modifying batch on a
        // production connection stops HERE until the user confirms; "don't
        // ask again this session" suppression lives in the guard closure.
        if (!this.productionConfirmedOnce && this.productionGuard?.shouldConfirm(text) === true) {
            void this.productionGuard.confirm().then((answer) => {
                if (answer === "no") {
                    return;
                }
                this.productionConfirmedOnce = true; // one-shot for re-entry
                try {
                    this.execute(text, options);
                } finally {
                    this.productionConfirmedOnce = false;
                }
            });
            return {
                started: false,
                reason: "Confirm the production warning to run this query.",
            };
        }

        // Resolve the QueryTuning snapshot ONCE for the whole run (QO-1):
        // it drives store limits, wire options, and is stamped on the run
        // record + submit marker so the run self-describes its parameters.
        const tuning = resolveQueryTuning(
            options.tuningOverrides ? { runOverrides: options.tuningOverrides } : {},
        );
        this.lastTuning = tuning;

        // Fresh run: the live owner releases its lease NOW. With no
        // snapshots holding leases that still disposes the previous store
        // (and spill) immediately, exactly as before; with leases, the store
        // survives demoted until the last snapshot releases (C2D-1).
        if (this.retained) {
            this.retained.releaseLiveOwner("rerun");
        } else {
            this.rowStore?.dispose();
        }
        this.runCounter++;
        this.rowStore = new RowStore(
            path.join(this.spillRoot, runSpillDirName(this.runCounter)),
            rowStoreLimitsFrom(tuning),
            tuning.params.diagnosticsLevel,
            rowStoreTuningFrom(tuning),
        );
        this.retained = new RetainedRowStore(this.rowStore, {
            runId: `qsrun_${crypto.randomBytes(6).toString("base64url")}`,
            createdEpochMs: Date.now(),
            ...(tuning.digest ? { tuningDigest: tuning.digest } : {}),
            ...(tuning.profileId ? { tuningProfileId: tuning.profileId } : {}),
            retainedMemoryBytes: resolveQueryResultsParams().params.retainedStoreMemoryBytes,
        });
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

        // Run-record capture (design 04 §17.2): armed via Replay Lab panel or
        // mssql.queryStudio.replay.enabled; digest-only unless elevated.
        const sessionInfo = session.info as { server?: string; database?: string } | undefined;
        this.activeRunRecordId = beginRunRecord({
            text,
            uriKey: this.uriKey,
            scope: options.scope,
            mode: options.mode ?? "normal",
            ...(sessionInfo?.server ? { server: sessionInfo.server } : {}),
            ...(sessionInfo?.database ? { database: sessionInfo.database } : {}),
            ...(this.binding.metadataStatus
                ? { catalogGeneration: this.binding.metadataStatus.generation }
                : {}),
            tuning,
            ...(options.replayTags ? { replayTags: options.replayTags } : {}),
        });
        // Snapshot provenance (C2D): join the retained store to the run record.
        this.retained.setRunRecordId(this.activeRunRecordId);
        this.msToFirstResult = undefined;

        const host = this;
        this.orchestrator = new ExecutionOrchestrator(session, this.rowStore, {
            onResultSetStarted(started) {
                const summary: QsResultSetSummary = {
                    resultSetId: started.resultSetId,
                    batchOrdinal: started.batchOrdinal,
                    columnNames: started.columnNames,
                    ...(started.columns ? { columns: started.columns } : {}),
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
            onFirstResult(msFromSubmit) {
                host.msToFirstResult = msFromSubmit;
            },
        });

        // State fan-out BEFORE the run starts: the orchestrator emits its
        // first synthesized message (the first batch's "Started executing
        // query at Line N") synchronously inside run() — listeners must
        // already know a new run owns the message stream.
        this.fan((l) => l.onRunStarted?.(this.startedEpochMs ?? Date.now()));
        this.fan((l) => l.onExecutionStateChanged());
        void this.orchestrator
            .run(text, {
                selectionStartLine: options.selectionStartLine,
                stopOnError: false,
                scope: options.scope,
                mode: options.mode ?? "normal",
                startedEpochMs: this.startedEpochMs ?? Date.now(),
                ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
                wire: {
                    pageRows: tuning.params.pageRows,
                    pageBytes: tuning.params.pageBytes,
                    maxCellBytes: tuning.params.maxCellBytes,
                },
                tuningDigest: tuning.digest,
                tuningProfileId: tuning.profileId,
            })
            .then(
                (result) => this.finishRun(result),
                (error) => {
                    const row: QsMessageRow = {
                        batchIndex: 0,
                        kind: "error",
                        text: error instanceof Error ? error.message : String(error),
                        epochMs: Date.now(),
                    };
                    this.messages.push(row);
                    this.fan((l) => l.onMessages([row]));
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
        return { started: true };
    }

    private finishRun(result: RunResult): void {
        completeRunRecord(
            this.activeRunRecordId,
            {
                status: result.status,
                batches: result.batches,
                resultSets: result.resultSets,
                totalRows: result.totalRows,
                errors: result.errors,
                ...(result.rowsAffected !== undefined ? { rowsAffected: result.rowsAffected } : {}),
                durationMs: result.durationMs,
            },
            this.msToFirstResult,
        );
        this.activeRunRecordId = undefined;
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
        // Queued restart (dogfood 2026-07-10): an execute that arrived while
        // this run was active starts NOW — before the post-run probe, so the
        // probe never steals the session's single query slot from the user.
        const rerun = this.pendingRerun;
        if (rerun) {
            this.pendingRerun = undefined;
            const outcome = this.execute(rerun.text, rerun.options);
            if (outcome.started) {
                return; // the rerun's own finishRun probes when it settles
            }
        }
        // Open-transaction indicator (SSMS parity): probe @@TRANCOUNT on the
        // SAME session after the run settles — a BEGIN TRAN without COMMIT
        // stays active across executions and must be visible + guarded.
        void this.binding.probeTransactionState();
    }

    cancel(): Promise<{ acknowledged: boolean }> {
        return this.orchestrator?.requestCancel() ?? Promise.resolve({ acknowledged: false });
    }

    async getRows(
        resultSetId: string,
        start: number,
        count: number,
        reason: RowReadReason = "grid",
        columns?: { start: number; count: number },
    ): Promise<QsCellWindow> {
        return (
            this.rowStore?.getRows(resultSetId, start, count, reason, columns) ??
            Promise.resolve({
                resultSetId,
                start,
                rowCount: 0,
                columns: [],
                values: [],
            })
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

    async listDatabases(): Promise<string[]> {
        if (this.executionState.kind === "executing") {
            return [];
        }
        // Master-first (STS v1 ListDatabaseRequestHandler parity): on Azure
        // SQL DB, sys.databases from a user database lists only master +
        // itself — a transient master-scoped session sees them all. No
        // master access → fall back to the current session's view.
        const viaMaster = await this.binding.listDatabasesViaMaster?.().catch(() => undefined);
        if (viaMaster !== undefined && viaMaster.length > 0) {
            return viaMaster;
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

    /** Live source surface for snapshot creation (C2D-1). */
    get retainedStore(): RetainedRowStore | undefined {
        return this.retained;
    }

    /** SQL text of the active/last run — local capture policy only. */
    get lastRunSql(): string | undefined {
        return this.lastRunText;
    }

    dispose(): void {
        if (this.retained) {
            this.retained.releaseLiveOwner("documentClosed");
            this.retained = undefined;
        } else {
            this.rowStore?.dispose();
        }
        this.rowStore = undefined;
        this.listeners.clear();
    }
}

/** Store limits come from the resolved tuning snapshot — no hardcoded caps (QO-1). */
function rowStoreLimitsFrom(tuning: QueryTuningSnapshot): RowStoreLimits {
    return {
        maxMemoryBytes: tuning.params.storeMemoryBytes,
        spillEnabled: tuning.params.spillEnabled,
        maxSpillBytes: tuning.params.storeSpillBytes,
        maxRowsPerResultSet: tuning.params.maxRowsPerResultSet,
    };
}

/** QO-6 cache/backpressure knobs from the same snapshot. */
function rowStoreTuningFrom(tuning: QueryTuningSnapshot): RowStoreTuning {
    return {
        maxPendingSpillBytes: tuning.params.maxPendingSpillBytes,
        protectedCacheRatio: tuning.params.protectedCacheRatio,
        windowCacheEntries: tuning.params.windowCacheEntries,
    };
}
