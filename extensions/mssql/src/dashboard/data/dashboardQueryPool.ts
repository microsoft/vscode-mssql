/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ColumnMetadata,
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
} from "../../services/sqlDataPlane/api";

const SESSION_INITIALIZATION_SQL = `SET NOCOUNT ON;
SET LOCK_TIMEOUT 3000;
SET DEADLOCK_PRIORITY LOW;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;`;

export interface DashboardQueryResult {
    columns: readonly ColumnMetadata[];
    rows: unknown[][];
    summary: QueryCompleteSummary;
    backendKind: string;
}

export class DashboardQueryError extends Error {
    constructor(
        readonly code: string,
        readonly retryable: boolean,
        message: string,
        readonly serverErrorNumber?: number,
        readonly outcomeCertainty: "known" | "unknown" = "known",
    ) {
        super(message);
        this.name = "DashboardQueryError";
    }
}

interface Lane {
    id: number;
    busy: boolean;
    session?: ISqlSession;
    initialized: boolean;
}

export type DashboardCollectorObservation =
    | { phase: "begin"; collector: string; cost: "cheap" | "moderate" | "heavy" }
    | { phase: "firstPage"; collector: string; rows: number }
    | { phase: "end"; collector: string; outcome: string; rows: number };

/**
 * Bounded dashboard session lanes. SQL data-plane sessions allow one active
 * query, so route collectors borrow at most four dedicated lanes rather than
 * contending with Query Studio or opening an unbounded connection fan-out.
 */
export class DashboardQueryPool {
    private readonly lanes: Lane[] = [];
    private readonly waiters: Array<{
        resolve: (lane: Lane) => void;
        reject: (error: Error) => void;
    }> = [];
    private disposed = false;

    constructor(
        private readonly openSession: (laneId: number) => Promise<ISqlSession>,
        private readonly maxLanes = 4,
        private readonly observe?: (event: DashboardCollectorObservation) => void,
    ) {
        if (!Number.isInteger(maxLanes) || maxLanes < 1 || maxLanes > 4) {
            throw new RangeError("Dashboard lane count must be between 1 and 4");
        }
    }

    async query(
        sql: string,
        options: {
            tag: string;
            timeoutMs: number;
            signal: AbortSignal;
            priority?: "interactive" | "background";
        },
    ): Promise<DashboardQueryResult> {
        this.observe?.({
            phase: "begin",
            collector: options.tag,
            cost:
                options.timeoutMs <= 5_000
                    ? "cheap"
                    : options.timeoutMs <= 15_000
                      ? "moderate"
                      : "heavy",
        });
        let lane: Lane | undefined;
        try {
            lane = await this.acquire(options.signal);
            const session = await this.ensureSession(lane, options.signal);
            if (!lane.initialized) {
                await this.execute(
                    session,
                    SESSION_INITIALIZATION_SQL,
                    {
                        tag: "dashboard:sessionInit",
                        timeoutMs: 5_000,
                        signal: options.signal,
                        priority: "background",
                    },
                    false,
                );
                lane.initialized = true;
            }
            const result = await this.execute(session, sql, options);
            this.observe?.({
                phase: "end",
                collector: options.tag,
                outcome: "succeeded",
                rows: result.rows.length,
            });
            return result;
        } catch (error) {
            if (
                error instanceof DashboardQueryError &&
                (error.code === "connectionLost" || error.outcomeCertainty === "unknown")
            ) {
                await lane?.session?.dispose();
                if (lane) {
                    lane.session = undefined;
                    lane.initialized = false;
                }
            }
            this.observe?.({
                phase: "end",
                collector: options.tag,
                outcome: error instanceof DashboardQueryError ? error.code : "collectorFailed",
                rows: 0,
            });
            throw error;
        } finally {
            if (lane) {
                this.release(lane);
            }
        }
    }

    private async acquire(signal: AbortSignal): Promise<Lane> {
        if (this.disposed) {
            throw new DashboardQueryError(
                "poolDisposed",
                false,
                "Dashboard query pool is disposed",
            );
        }
        if (signal.aborted) {
            throw new DashboardQueryError("cancelled", true, "Dashboard query was cancelled");
        }
        const idle = this.lanes.find((lane) => !lane.busy);
        if (idle) {
            idle.busy = true;
            return idle;
        }
        if (this.lanes.length < this.maxLanes) {
            const lane: Lane = {
                id: this.lanes.length + 1,
                busy: true,
                initialized: false,
            };
            this.lanes.push(lane);
            return lane;
        }
        return new Promise<Lane>((resolve, reject) => {
            let waiter: (typeof this.waiters)[number];
            const onAbort = () => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0) {
                    this.waiters.splice(index, 1);
                }
                reject(new DashboardQueryError("cancelled", true, "Dashboard query was cancelled"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            waiter = {
                resolve: (lane) => {
                    signal.removeEventListener("abort", onAbort);
                    resolve(lane);
                },
                reject: (error) => {
                    signal.removeEventListener("abort", onAbort);
                    reject(error);
                },
            };
            this.waiters.push(waiter);
        });
    }

    private release(lane: Lane): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            lane.busy = true;
            waiter.resolve(lane);
            return;
        }
        lane.busy = false;
    }

    private async ensureSession(lane: Lane, signal: AbortSignal): Promise<ISqlSession> {
        if (lane.session?.state === "open") {
            return lane.session;
        }
        if (signal.aborted) {
            throw new DashboardQueryError("cancelled", true, "Dashboard query was cancelled");
        }
        lane.session = await this.openSession(lane.id);
        lane.initialized = false;
        return lane.session;
    }

    private async execute(
        session: ISqlSession,
        sql: string,
        options: {
            tag: string;
            timeoutMs: number;
            signal: AbortSignal;
            priority?: "interactive" | "background";
        },
        observeFirstPage = true,
    ): Promise<DashboardQueryResult> {
        const rows: unknown[][] = [];
        let columns: readonly ColumnMetadata[] = [];
        let message: string | undefined;
        let serverErrorNumber: number | undefined;
        let firstPageObserved = false;
        const sink: IQueryEventSink = {
            onResultSetStarted: (metadata) => {
                if (columns.length === 0) {
                    columns = metadata.columns;
                }
            },
            onRowsPage: (page) => {
                rows.push(...page.compact.values);
                if (observeFirstPage && !firstPageObserved) {
                    firstPageObserved = true;
                    this.observe?.({
                        phase: "firstPage",
                        collector: options.tag,
                        rows: page.rowCount,
                    });
                }
            },
            onMessage: (event) => {
                if (event.kind === "error") {
                    message = event.text;
                    serverErrorNumber = event.number;
                }
            },
            onComplete: () => undefined,
        };
        const handle = session.execute(
            sql,
            {
                priority: options.priority ?? "background",
                commandKind: "dashboard",
                tag: options.tag,
                timeoutMs: options.timeoutMs,
                pageRows: 256,
                pageBytes: 128 * 1024,
                maxCellBytes: 32 * 1024,
            },
            sink,
        );

        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        let cancelled = false;
        let removeAbortListener = () => undefined;
        const stop = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                timedOut = true;
                void handle.cancel();
                reject(
                    new DashboardQueryError(
                        "timeout",
                        true,
                        `Dashboard collector exceeded its ${options.timeoutMs} ms budget`,
                    ),
                );
            }, options.timeoutMs);
            const rejectOnAbort = () => {
                cancelled = true;
                void handle.cancel();
                reject(new DashboardQueryError("cancelled", true, "Dashboard query was cancelled"));
            };
            options.signal.addEventListener("abort", rejectOnAbort, { once: true });
            removeAbortListener = () => options.signal.removeEventListener("abort", rejectOnAbort);
        });

        try {
            const summary = await Promise.race([handle.completion, stop]);
            if (summary.status !== "succeeded") {
                throw new DashboardQueryError(
                    summary.outcomeReason ?? summary.status,
                    summary.status === "connectionLost",
                    message ?? `Dashboard query ${summary.status}`,
                    serverErrorNumber,
                    summary.outcomeCertainty ?? "known",
                );
            }
            return { columns, rows, summary, backendKind: session.info.backendKind };
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            removeAbortListener();
            if (timedOut || cancelled) {
                await handle.dispose();
                await handle.completion;
            }
        }
    }

    async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const error = new DashboardQueryError(
            "poolDisposed",
            false,
            "Dashboard query pool is disposed",
        );
        for (const waiter of this.waiters.splice(0)) {
            waiter.reject(error);
        }
        await Promise.all(
            this.lanes.map(async (lane) => {
                await lane.session?.dispose();
                lane.session = undefined;
                lane.initialized = false;
            }),
        );
    }
}
