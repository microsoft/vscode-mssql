/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A data point that the Query Store reports show. Every metric is a column of
 * `sys.query_store_runtime_stats`, except `waitTime`, which comes from
 * `sys.query_store_wait_stats`.
 */
export type QueryStoreMetric =
    | "cpuTime"
    | "duration"
    | "logicalWrites"
    | "logicalReads"
    | "memoryConsumption"
    | "physicalReads"
    | "executionCount"
    | "clrTime"
    | "dop"
    | "rowCount"
    | "logMemoryUsed"
    | "tempDbMemoryUsed"
    | "waitTime";

/** The unit that a metric is shown in. Callers show localized text for each code. */
export type QueryStoreMetricUnit = "millisecond" | "kilobyte";

export interface QueryStoreMetricInfo {
    /**
     * The column that shows the server records the metric: a `sys.query_store_runtime_stats`
     * column, or `wait_stats_id` for wait time.
     */
    readonly databaseColumnName: string;
    /** The name in generated column labels, for example `cpu_time` in `avg_cpu_time`. */
    readonly queryString: string;
    /** Undefined for counts. */
    readonly unit?: QueryStoreMetricUnit;
    /**
     * Converts the recorded unit to the shown unit. For example, durations are recorded in
     * microseconds and shown in milliseconds, and reads are recorded in 8 KB pages and shown in KB.
     */
    readonly conversionFactor: number;
    /** The number of decimal places that the generated SQL rounds to. */
    readonly roundOffPoints: number;
}

/** Every metric, in the order of the C# `Metric` enum. */
export const queryStoreMetrics: readonly QueryStoreMetric[] = [
    "cpuTime",
    "duration",
    "logicalWrites",
    "logicalReads",
    "memoryConsumption",
    "physicalReads",
    "executionCount",
    "clrTime",
    "dop",
    "rowCount",
    "logMemoryUsed",
    "tempDbMemoryUsed",
    "waitTime",
];

const microsecondsToMilliseconds = 0.001;
const pagesToKilobytes = 8;
const bytesToKilobytes = 0.0009765625;

const metricInfo: Readonly<Record<QueryStoreMetric, QueryStoreMetricInfo>> = {
    cpuTime: {
        databaseColumnName: "avg_cpu_time",
        queryString: "cpu_time",
        unit: "millisecond",
        conversionFactor: microsecondsToMilliseconds,
        roundOffPoints: 2,
    },
    duration: {
        databaseColumnName: "avg_duration",
        queryString: "duration",
        unit: "millisecond",
        conversionFactor: microsecondsToMilliseconds,
        roundOffPoints: 2,
    },
    logicalWrites: {
        databaseColumnName: "avg_logical_io_writes",
        queryString: "logical_io_writes",
        unit: "kilobyte",
        conversionFactor: pagesToKilobytes,
        roundOffPoints: 2,
    },
    logicalReads: {
        databaseColumnName: "avg_logical_io_reads",
        queryString: "logical_io_reads",
        unit: "kilobyte",
        conversionFactor: pagesToKilobytes,
        roundOffPoints: 2,
    },
    memoryConsumption: {
        databaseColumnName: "avg_query_max_used_memory",
        queryString: "query_max_used_memory",
        unit: "kilobyte",
        conversionFactor: pagesToKilobytes,
        roundOffPoints: 2,
    },
    physicalReads: {
        databaseColumnName: "avg_physical_io_reads",
        queryString: "physical_io_reads",
        unit: "kilobyte",
        conversionFactor: pagesToKilobytes,
        roundOffPoints: 2,
    },
    executionCount: {
        databaseColumnName: "count_executions",
        queryString: "count_executions",
        conversionFactor: 1,
        roundOffPoints: 0,
    },
    clrTime: {
        databaseColumnName: "avg_clr_time",
        queryString: "clr_time",
        unit: "millisecond",
        conversionFactor: microsecondsToMilliseconds,
        roundOffPoints: 2,
    },
    dop: {
        databaseColumnName: "avg_dop",
        queryString: "dop",
        conversionFactor: 1,
        roundOffPoints: 0,
    },
    rowCount: {
        databaseColumnName: "avg_rowcount",
        queryString: "rowcount",
        conversionFactor: 1,
        roundOffPoints: 0,
    },
    logMemoryUsed: {
        databaseColumnName: "avg_log_bytes_used",
        queryString: "log_bytes_used",
        unit: "kilobyte",
        conversionFactor: bytesToKilobytes,
        roundOffPoints: 2,
    },
    tempDbMemoryUsed: {
        databaseColumnName: "avg_tempdb_space_used",
        queryString: "tempdb_space_used",
        unit: "kilobyte",
        conversionFactor: pagesToKilobytes,
        roundOffPoints: 2,
    },
    waitTime: {
        databaseColumnName: "wait_stats_id",
        queryString: "query_wait_time",
        unit: "millisecond",
        conversionFactor: 1,
        roundOffPoints: 2,
    },
};

export function isQueryStoreMetric(value: unknown): value is QueryStoreMetric {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(metricInfo, value);
}

/**
 * Returns the metric, or throws a `RangeError` when the value is not a metric.
 */
export function assertQueryStoreMetric(value: unknown): QueryStoreMetric {
    if (!isQueryStoreMetric(value)) {
        throw new RangeError(`"${String(value)}" is not a Query Store metric.`);
    }
    return value;
}

export function getMetricInfo(metric: QueryStoreMetric): QueryStoreMetricInfo {
    return metricInfo[assertQueryStoreMetric(metric)];
}

/** C# `MetricUtils.QueryString`. */
export function metricQueryString(metric: QueryStoreMetric): string {
    return getMetricInfo(metric).queryString;
}

/** C# `MetricUtils.GetConversionFactor`. */
export function metricConversionFactor(metric: QueryStoreMetric): number {
    return getMetricInfo(metric).conversionFactor;
}

/** C# `MetricUtils.GetRoundOffPoints`. */
export function metricRoundOffPoints(metric: QueryStoreMetric): number {
    return getMetricInfo(metric).roundOffPoints;
}

/**
 * Maps the database column names to metrics. C# `MetricUtils.DbNamesToServerSupportedMetricMapping`.
 */
export function dbNamesToMetricMapping(): ReadonlyMap<string, QueryStoreMetric> {
    return new Map(
        queryStoreMetrics.map((metric) => [metricInfo[metric].databaseColumnName, metric]),
    );
}
