/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlBigIntLiteral, sqlIntLiteral } from "../common/literals";
import {
    SqlReader,
    SqlRecord,
    readDateTime,
    readId,
    readNumber,
    toRecords,
} from "../common/sqlReader";
import { QueryStoreCapabilities } from "./capabilities";
import {
    MetricStats,
    QueryStoreMetric,
    QueryStoreRuntimeStats,
    QueryStoreStatistic,
    definitionOf,
} from "./metrics";
import {
    QueryStoreReadOptions,
    QueryStoreResult,
    TimeWindow,
    runQueryStoreRead,
    windowDeclarations,
} from "./state";

/*
 * Runtime stats rows are per plan, interval, and execution type. A read sums them in two steps:
 * first for each plan (or plan and interval) from `sys.query_store_runtime_stats`, then, when it
 * needs it, for each query from those sums. Each metric has four sums, in the recorded unit:
 *
 *   <column>_total  SUM(avg * executions)
 *   <column>_min    MIN(min)
 *   <column>_max    MAX(max)
 *   <column>_sq     SUM(stdev * stdev * executions), for the pooled standard deviation
 *
 * The sums of the second step use the same names, so one mapper reads both.
 */

/** @internal The first-step sums of the metrics over `sys.query_store_runtime_stats AS rs`. */
export function runtimeStatsColumns(metrics: readonly QueryStoreMetric[]): string {
    return [
        "SUM(rs.count_executions) AS executions",
        ...metrics.flatMap((metric) => {
            const column = definitionOf(metric).column;
            return [
                `SUM(rs.avg_${column} * rs.count_executions) AS ${column}_total`,
                `MIN(rs.min_${column}) AS ${column}_min`,
                `MAX(rs.max_${column}) AS ${column}_max`,
                `SUM(SQUARE(rs.stdev_${column}) * rs.count_executions) AS ${column}_sq`,
            ];
        }),
    ].join(",\n    ");
}

/** @internal The second-step sums over rows that have the first-step columns. */
export function rollupColumns(metrics: readonly QueryStoreMetric[], alias: string): string {
    return [
        `SUM(${alias}.executions) AS executions`,
        ...metrics.flatMap((metric) => {
            const column = definitionOf(metric).column;
            return [
                `SUM(${alias}.${column}_total) AS ${column}_total`,
                `MIN(${alias}.${column}_min) AS ${column}_min`,
                `MAX(${alias}.${column}_max) AS ${column}_max`,
                `SUM(${alias}.${column}_sq) AS ${column}_sq`,
            ];
        }),
    ].join(",\n    ");
}

/** @internal The column list of a table that holds first-step sums. */
export function runtimeStatsTableColumns(metrics: readonly QueryStoreMetric[]): string {
    return [
        "executions bigint NOT NULL",
        ...metrics.flatMap((metric) => {
            const column = definitionOf(metric).column;
            return ["total", "min", "max", "sq"].map((part) => `${column}_${part} float NULL`);
        }),
    ].join(",\n    ");
}

/** @internal The names of the first-step columns, for an `INSERT` column list. */
export function runtimeStatsColumnNames(metrics: readonly QueryStoreMetric[]): string[] {
    return [
        "executions",
        ...metrics.flatMap((metric) => {
            const column = definitionOf(metric).column;
            return ["total", "min", "max", "sq"].map((part) => `${column}_${part}`);
        }),
    ];
}

/**
 * @internal The second-step value of a statistic of a metric, for an `ORDER BY` over rows that
 * have the first-step columns.
 */
export function rollupStatisticExpression(
    metric: QueryStoreMetric | "executionCount",
    statistic: QueryStoreStatistic,
    alias: string,
): string {
    if (metric === "executionCount") {
        return `SUM(${alias}.executions)`;
    }
    const column = definitionOf(metric).column;
    switch (statistic) {
        case "total":
            return `SUM(${alias}.${column}_total)`;
        case "avg":
            return `SUM(${alias}.${column}_total) / NULLIF(SUM(${alias}.executions), 0)`;
        case "min":
            return `MIN(${alias}.${column}_min)`;
        case "max":
            return `MAX(${alias}.${column}_max)`;
        case "stdev":
            return `SQRT(SUM(${alias}.${column}_sq) / NULLIF(SUM(${alias}.executions), 0))`;
        default:
            throw new RangeError(`"${String(statistic)}" is not a Query Store statistic.`);
    }
}

/**
 * @internal The `FROM` and `WHERE` of the runtime stats in `@window_start` to `@window_end`,
 * of the primary replica when the server has replica groups.
 */
export function windowedRuntimeStats(
    capabilities: QueryStoreCapabilities,
    extraFilter?: string,
    apply?: string,
): string {
    return [
        "FROM sys.query_store_runtime_stats AS rs",
        "    JOIN sys.query_store_runtime_stats_interval AS rsi",
        "        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id",
        ...(apply ? [`    ${apply}`] : []),
        "WHERE rsi.start_time >= @window_start",
        "    AND rsi.start_time < @window_end",
        ...(capabilities.hasReplicaGroups ? ["    AND rs.replica_group_id = 1"] : []),
        ...(extraFilter ? [`    AND ${extraFilter}`] : []),
    ].join("\n");
}

/** @internal Maps the sums of a row to runtime stats in the metrics' units. */
export function readRuntimeStats(
    record: SqlRecord,
    metrics: readonly QueryStoreMetric[],
): QueryStoreRuntimeStats {
    const executionCount = readNumber(record, "executions") ?? 0;
    const values: Partial<Record<QueryStoreMetric, MetricStats>> = {};
    if (executionCount > 0) {
        for (const metric of metrics) {
            const { column, factor } = definitionOf(metric);
            const total = readNumber(record, `${column}_total`) ?? 0;
            const squares = readNumber(record, `${column}_sq`) ?? 0;
            values[metric] = {
                total: total * factor,
                avg: (total / executionCount) * factor,
                min: (readNumber(record, `${column}_min`) ?? 0) * factor,
                max: (readNumber(record, `${column}_max`) ?? 0) * factor,
                stdev: Math.sqrt(squares / executionCount) * factor,
            };
        }
    }
    return { executionCount, metrics: values };
}

/** Combines runtime stats, for example the plans of a query in one interval. */
export function combineRuntimeStats(
    stats: readonly QueryStoreRuntimeStats[],
): QueryStoreRuntimeStats {
    const executionCount = stats.reduce((sum, item) => sum + item.executionCount, 0);
    const metrics: Partial<Record<QueryStoreMetric, MetricStats>> = {};
    if (executionCount > 0) {
        const names = new Set(stats.flatMap((item) => Object.keys(item.metrics)));
        for (const metric of names as Set<QueryStoreMetric>) {
            const parts = stats.filter((item) => item.metrics[metric] !== undefined);
            const count = parts.reduce((sum, item) => sum + item.executionCount, 0);
            const total = parts.reduce((sum, item) => sum + item.metrics[metric]!.total, 0);
            const squares = parts.reduce(
                (sum, item) => sum + item.metrics[metric]!.stdev ** 2 * item.executionCount,
                0,
            );
            metrics[metric] = {
                total,
                avg: count > 0 ? total / count : 0,
                min: Math.min(...parts.map((item) => item.metrics[metric]!.min)),
                max: Math.max(...parts.map((item) => item.metrics[metric]!.max)),
                stdev: count > 0 ? Math.sqrt(squares / count) : 0,
            };
        }
    }
    return { executionCount, metrics };
}

/** @internal Checks the requested metrics against the server's. */
export function resolveMetrics(
    capabilities: QueryStoreCapabilities,
    requested: readonly QueryStoreMetric[],
): QueryStoreMetric[] {
    const metrics = [...new Set(requested)];
    for (const metric of metrics) {
        definitionOf(metric);
    }
    return metrics.filter((metric) => capabilities.metrics.includes(metric));
}

/** The runtime stats of one plan in an interval. */
export interface QueryStorePlanIntervalStats extends QueryStoreRuntimeStats {
    readonly planId: string;
}

/** The runtime stats of a query in one runtime stats interval: all its plans together. */
export interface QueryStoreInterval extends QueryStoreRuntimeStats {
    /** ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
    /** The plans that ran in the interval, by plan ID. */
    readonly plans: readonly QueryStorePlanIntervalStats[];
}

export interface QueryHistoryRequest extends TimeWindow {
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: string;
    readonly metrics: readonly QueryStoreMetric[];
    /**
     * The shortest bucket to sum the intervals into, in minutes, so that a long window gives
     * fewer rows. The server rounds it up to a multiple of its interval length, so that each
     * interval falls in one bucket. Default: one row for each interval.
     */
    readonly bucketMinutes?: number;
}

/** The longest bucket of a history read: a week. */
const maxBucketMinutes = 7 * 24 * 60;
/** Bucket lengths that divide days evenly, up to a week. */
const bucketSteps = [1, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, maxBucketMinutes];

/**
 * The shortest bucket, in minutes, that splits the window into at most `maxBuckets` buckets, for
 * {@link QueryHistoryRequest.bucketMinutes}. A week for a window too long for that.
 */
export function historyBucketMinutes(window: TimeWindow, maxBuckets: number): number {
    const minutes = (window.end.getTime() - window.start.getTime()) / 60_000;
    return bucketSteps.find((step) => step * maxBuckets >= minutes) ?? maxBucketMinutes;
}

/**
 * Reads one row for each runtime stats interval of the window in which the query ran, or for each
 * bucket of intervals, in time order. `noData` when the query did not run in the window.
 */
export async function getQueryHistory(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    request: QueryHistoryRequest,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<readonly QueryStoreInterval[]>> {
    const metrics = resolveMetrics(capabilities, request.metrics);
    const { bucketMinutes } = request;
    const filter =
        "rs.plan_id IN (SELECT p.plan_id FROM sys.query_store_plan AS p WHERE p.query_id = @query_id)";
    // Buckets start at multiples of their length from a fixed time, as the intervals do, so an
    // interval never spans two buckets.
    const body =
        bucketMinutes === undefined
            ? `SELECT
    rsi.start_time,
    rsi.end_time,
    rs.plan_id,
    ${runtimeStatsColumns(metrics)}
${windowedRuntimeStats(capabilities, filter)}
GROUP BY rsi.runtime_stats_interval_id, rsi.start_time, rsi.end_time, rs.plan_id
ORDER BY rsi.start_time, rs.plan_id;`
            : `SELECT @bucket_minutes = CEILING(1.0 * @bucket_minutes / interval_length_minutes) * interval_length_minutes
FROM sys.database_query_store_options
WHERE interval_length_minutes > 0;
SELECT
    b.bucket_start AS start_time,
    DATEADD(minute, @bucket_minutes, b.bucket_start) AS end_time,
    rs.plan_id,
    ${runtimeStatsColumns(metrics)}
${windowedRuntimeStats(
    capabilities,
    filter,
    "CROSS APPLY (SELECT DATEADD(minute, DATEDIFF(minute, @bucket_epoch, rsi.start_time) / @bucket_minutes * @bucket_minutes, @bucket_epoch) AS bucket_start) AS b",
)}
GROUP BY b.bucket_start, rs.plan_id
ORDER BY b.bucket_start, rs.plan_id;`;
    return runQueryStoreRead(reader, capabilities, options, {
        declarations: [
            ...windowDeclarations(request),
            `DECLARE @query_id bigint = ${sqlBigIntLiteral(request.queryId)};`,
            ...(bucketMinutes === undefined
                ? []
                : [
                      `DECLARE @bucket_minutes int = ${sqlIntLiteral(bucketMinutes, 1, maxBucketMinutes)};`,
                      "DECLARE @bucket_epoch datetimeoffset = '1970-01-01T00:00:00+00:00';",
                  ]),
        ],
        body,
        map: ([resultSet]) => {
            const intervals = toIntervals(toRecords(resultSet), metrics);
            return intervals.length > 0 ? intervals : undefined;
        },
    });
}

function toIntervals(
    records: readonly SqlRecord[],
    metrics: readonly QueryStoreMetric[],
): QueryStoreInterval[] {
    const intervals: QueryStoreInterval[] = [];
    let current: { startUtc: string; endUtc: string; plans: QueryStorePlanIntervalStats[] } = {
        startUtc: "",
        endUtc: "",
        plans: [],
    };
    const close = () => {
        if (current.plans.length > 0) {
            intervals.push({ ...current, ...combineRuntimeStats(current.plans) });
        }
    };
    for (const record of records) {
        const startUtc = readDateTime(record, "start_time") ?? "";
        if (startUtc !== current.startUtc) {
            close();
            current = { startUtc, endUtc: readDateTime(record, "end_time") ?? "", plans: [] };
        }
        current.plans.push({
            planId: readId(record, "plan_id") ?? "",
            ...readRuntimeStats(record, metrics),
        });
    }
    close();
    return intervals;
}
