/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlBigIntLiteral, sqlIntLiteral } from "../common/literals";
import {
    SqlReader,
    SqlRecord,
    readDateTime,
    readNumber,
    readString,
    toRecords,
} from "../common/sqlReader";
import { QueryStoreCapabilities } from "./capabilities";
import { readRuntimeStats, runtimeStatsColumns, windowedRuntimeStats } from "./runtimeStats";
import {
    QueryStoreReadOptions,
    QueryStoreResult,
    TimeWindow,
    runQueryStoreRead,
    windowDeclarations,
} from "./state";

/** The wait time of one wait category, for example `Buffer IO`, in a window. */
export interface WaitCategoryStats {
    /** `wait_category_desc`, as the server names it, for example `Buffer IO` or `Lock`. */
    readonly category: string;
    readonly totalMs: number;
    /** The total over the executions in the window. Absent without executions. */
    readonly avgMsPerExecution?: number;
    /** The longest wait of one execution. */
    readonly maxMs: number;
    /** The part of all the wait time in the window, from 0 to 1. */
    readonly share: number;
}

/** The wait time of each category in one bucket of the window. */
export interface WaitStatsInterval {
    /** ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
    /** Milliseconds by wait category. */
    readonly waits: Readonly<Record<string, number>>;
}

export interface QueryStoreWaitStats {
    /** Whether Query Store captures wait statistics now. Off gives no new waits. */
    readonly captureMode: "on" | "off";
    /** The executions in the window, for the average wait of an execution. */
    readonly executionCount: number;
    /** The duration of those executions, in milliseconds, for the part of it spent waiting. */
    readonly durationTotalMs: number;
    readonly totalWaitMs: number;
    /** Most wait time first. */
    readonly categories: readonly WaitCategoryStats[];
    /** In time order, only the buckets with waits. */
    readonly intervals: readonly WaitStatsInterval[];
}

export interface WaitStatsRequest extends TimeWindow {
    /** One query's waits. Default: every query of the database. */
    readonly queryId?: string;
    /** One plan's waits. */
    readonly planId?: string;
    /**
     * The bucket length of `intervals`, in minutes, rounded up to a multiple of the interval
     * length. Default: one bucket for each interval.
     */
    readonly bucketMinutes?: number;
}

/** The longest bucket: a week. */
const maxBucketMinutes = 7 * 24 * 60;

/**
 * Reads the wait time of each wait category in the window, for the database, one query, or one
 * plan, with the executions and their duration, so a caller can tell waiting from working.
 * `unsupported` before SQL Server 2017, which has no wait statistics in Query Store.
 */
export async function getWaitStats(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    request: WaitStatsRequest,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<QueryStoreWaitStats>> {
    if (!capabilities.hasWaitStatsCapture) {
        return { status: "unsupported" };
    }
    const declarations = [...windowDeclarations(request), "DECLARE @wait_capture int;"];
    // Each filter takes the plan ID column that it filters, as the waits and the runtime stats
    // have their own.
    const filters: ((planColumn: string) => string)[] = [];
    if (request.queryId !== undefined) {
        declarations.push(`DECLARE @query_id bigint = ${sqlBigIntLiteral(request.queryId)};`);
        filters.push(
            (column) =>
                `${column} IN (SELECT p.plan_id FROM sys.query_store_plan AS p WHERE p.query_id = @query_id)`,
        );
    }
    if (request.planId !== undefined) {
        declarations.push(`DECLARE @plan_id bigint = ${sqlBigIntLiteral(request.planId)};`);
        filters.push((column) => `${column} = @plan_id`);
    }
    const bucketed = request.bucketMinutes !== undefined;
    if (bucketed) {
        declarations.push(
            `DECLARE @bucket_minutes int = ${sqlIntLiteral(request.bucketMinutes!, 1, maxBucketMinutes)};`,
            "DECLARE @bucket_epoch datetimeoffset = '1970-01-01T00:00:00+00:00';",
        );
    }
    const filterOn = (column: string) => filters.map((filter) => `    AND ${filter(column)}`);
    const bucketStart = bucketed
        ? "DATEADD(minute, DATEDIFF(minute, @bucket_epoch, rsi.start_time) / @bucket_minutes * @bucket_minutes, @bucket_epoch)"
        : "rsi.start_time";
    const bucketEnd = bucketed
        ? `DATEADD(minute, @bucket_minutes, ${bucketStart})`
        : "rsi.end_time";
    const body = [
        ...(bucketed
            ? [
                  "SELECT @bucket_minutes = CEILING(1.0 * @bucket_minutes / interval_length_minutes) * interval_length_minutes",
                  "FROM sys.database_query_store_options",
                  "WHERE interval_length_minutes > 0;",
              ]
            : []),
        "SELECT @wait_capture = wait_stats_capture_mode FROM sys.database_query_store_options;",
        "SELECT @wait_capture AS wait_capture;",
        "SELECT",
        "    ws.wait_category_desc AS category,",
        `    ${bucketStart} AS start_time,`,
        `    MAX(${bucketEnd}) AS end_time,`,
        "    SUM(ws.total_query_wait_time_ms) AS total_ms,",
        "    MAX(ws.max_query_wait_time_ms) AS max_ms",
        "FROM sys.query_store_wait_stats AS ws",
        "    JOIN sys.query_store_runtime_stats_interval AS rsi",
        "        ON rsi.runtime_stats_interval_id = ws.runtime_stats_interval_id",
        "WHERE rsi.start_time >= @window_start",
        "    AND rsi.start_time < @window_end",
        ...(capabilities.hasWaitStatsReplicaGroups ? ["    AND ws.replica_group_id = 1"] : []),
        ...filterOn("ws.plan_id"),
        `GROUP BY ws.wait_category_desc, ${bucketStart}`,
        "ORDER BY start_time, category;",
        "SELECT",
        `    ${runtimeStatsColumns(["duration"])}`,
        windowedRuntimeStats(
            capabilities,
            filters.length > 0
                ? filters.map((filter) => filter("rs.plan_id")).join(" AND ")
                : undefined,
        ) + ";",
    ].join("\n");
    return runQueryStoreRead(reader, capabilities, options, {
        declarations,
        body,
        map: ([captureSet, waitSet, executionSet]) =>
            toWaitStats(
                readNumber(toRecords(captureSet)[0] ?? {}, "wait_capture"),
                toRecords(waitSet),
                toRecords(executionSet)[0] ?? {},
            ),
    });
}

function toWaitStats(
    capture: number | undefined,
    waitRecords: readonly SqlRecord[],
    executionRecord: SqlRecord,
): QueryStoreWaitStats | undefined {
    const runtime = readRuntimeStats(executionRecord, ["duration"]);
    const captureMode = capture === 1 ? "on" : "off";
    if (waitRecords.length === 0 && runtime.executionCount === 0) {
        // Without executions there is nothing to explain, unless the capture is off, which the
        // caller shows.
        return captureMode === "off"
            ? {
                  captureMode,
                  executionCount: 0,
                  durationTotalMs: 0,
                  totalWaitMs: 0,
                  categories: [],
                  intervals: [],
              }
            : undefined;
    }
    const byCategory = new Map<string, { totalMs: number; maxMs: number }>();
    const intervals: { startUtc: string; endUtc: string; waits: Record<string, number> }[] = [];
    for (const record of waitRecords) {
        const category = readString(record, "category") ?? "Unknown";
        const totalMs = readNumber(record, "total_ms") ?? 0;
        const maxMs = readNumber(record, "max_ms") ?? 0;
        const startUtc = readDateTime(record, "start_time") ?? "";
        let interval = intervals[intervals.length - 1];
        if (!interval || interval.startUtc !== startUtc) {
            interval = { startUtc, endUtc: readDateTime(record, "end_time") ?? "", waits: {} };
            intervals.push(interval);
        }
        interval.waits[category] = (interval.waits[category] ?? 0) + totalMs;
        const current = byCategory.get(category) ?? { totalMs: 0, maxMs: 0 };
        byCategory.set(category, {
            totalMs: current.totalMs + totalMs,
            maxMs: Math.max(current.maxMs, maxMs),
        });
    }
    const totalWaitMs = [...byCategory.values()].reduce((sum, item) => sum + item.totalMs, 0);
    const executionCount = runtime.executionCount;
    const categories = [...byCategory.entries()]
        .map(([category, stats]) => ({
            category,
            totalMs: stats.totalMs,
            ...(executionCount > 0 ? { avgMsPerExecution: stats.totalMs / executionCount } : {}),
            maxMs: stats.maxMs,
            share: totalWaitMs > 0 ? stats.totalMs / totalWaitMs : 0,
        }))
        .sort((left, right) => right.totalMs - left.totalMs);
    return {
        captureMode,
        executionCount,
        durationTotalMs: runtime.metrics.duration?.total ?? 0,
        totalWaitMs,
        categories,
        intervals,
    };
}
