/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A measure of `sys.query_store_runtime_stats` that each execution records. */
export type QueryStoreMetric =
    | "cpuTime"
    | "duration"
    | "logicalReads"
    | "logicalWrites"
    | "physicalReads"
    | "memoryGrant"
    | "rowCount"
    | "logBytesUsed"
    | "tempdbSpaceUsed";

/** What a query list is ranked by: a metric, or the number of executions. */
export type QueryStoreRanking = QueryStoreMetric | "executionCount";

/** An aggregation of a metric over executions. */
export type QueryStoreStatistic = "total" | "avg" | "min" | "max" | "stdev";

/** The unit of a metric's values. Callers show localized text for each code. */
export type QueryStoreMetricUnit = "millisecond" | "kilobyte" | "count";

export const queryStoreMetrics: readonly QueryStoreMetric[] = [
    "cpuTime",
    "duration",
    "logicalReads",
    "logicalWrites",
    "physicalReads",
    "memoryGrant",
    "rowCount",
    "logBytesUsed",
    "tempdbSpaceUsed",
];

export const queryStoreStatistics: readonly QueryStoreStatistic[] = [
    "total",
    "avg",
    "min",
    "max",
    "stdev",
];

/** One metric over a set of executions, in the metric's unit. */
export interface MetricStats {
    readonly total: number;
    readonly avg: number;
    readonly min: number;
    readonly max: number;
    /** The pooled standard deviation, like the Query Store reports of SQL Server Management Studio. */
    readonly stdev: number;
}

/** The executions of a query, a plan, or an interval, with the requested metrics. */
export interface QueryStoreRuntimeStats {
    readonly executionCount: number;
    /** Only the requested metrics. Absent for a metric when there are no executions. */
    readonly metrics: Partial<Record<QueryStoreMetric, MetricStats>>;
}

interface MetricDefinition {
    /** The column name after `avg_`, `min_`, `max_`, and `stdev_`. */
    readonly column: string;
    readonly unit: QueryStoreMetricUnit;
    /** Converts the recorded unit (microseconds, 8 KB pages, bytes) to `unit`. */
    readonly factor: number;
}

const microsecondsToMilliseconds = 0.001;
const pagesToKilobytes = 8;
const bytesToKilobytes = 1 / 1024;

const definitions: Readonly<Record<QueryStoreMetric, MetricDefinition>> = {
    cpuTime: { column: "cpu_time", unit: "millisecond", factor: microsecondsToMilliseconds },
    duration: { column: "duration", unit: "millisecond", factor: microsecondsToMilliseconds },
    logicalReads: { column: "logical_io_reads", unit: "kilobyte", factor: pagesToKilobytes },
    logicalWrites: { column: "logical_io_writes", unit: "kilobyte", factor: pagesToKilobytes },
    physicalReads: { column: "physical_io_reads", unit: "kilobyte", factor: pagesToKilobytes },
    memoryGrant: { column: "query_max_used_memory", unit: "kilobyte", factor: pagesToKilobytes },
    rowCount: { column: "rowcount", unit: "count", factor: 1 },
    logBytesUsed: { column: "log_bytes_used", unit: "kilobyte", factor: bytesToKilobytes },
    tempdbSpaceUsed: { column: "tempdb_space_used", unit: "kilobyte", factor: pagesToKilobytes },
};

export function isQueryStoreMetric(value: unknown): value is QueryStoreMetric {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(definitions, value);
}

export function isQueryStoreStatistic(value: unknown): value is QueryStoreStatistic {
    return typeof value === "string" && (queryStoreStatistics as readonly string[]).includes(value);
}

export function metricUnit(metric: QueryStoreMetric): QueryStoreMetricUnit {
    return definitionOf(metric).unit;
}

/** @internal The `sys.query_store_runtime_stats` column and conversion of a metric. */
export function definitionOf(metric: QueryStoreMetric): MetricDefinition {
    if (!isQueryStoreMetric(metric)) {
        throw new RangeError(`"${String(metric)}" is not a Query Store metric.`);
    }
    return definitions[metric];
}
