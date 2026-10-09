/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import { SqlReader, readNumber, toRecords } from "../../common/sqlReader";
import { PerfResult } from "../result";
import {
    QueryStoreMetric,
    assertQueryStoreMetric,
    metricConversionFactor,
    metricQueryString,
} from "../queryStore/common/metric";
import { queryStoreParameters } from "../queryStore/common/queryGeneratorUtils";
import { replicaGroupIds } from "../queryStore/common/replicaGroup";
import { replicaGroupIdParameter } from "../queryStore/common/reportParameters";
import { formatBigInt, prependSqlParameters } from "../queryStore/common/sqlParameters";
import { QueryStoreRunOptions, runWithQueryStore, unsupportedOutcome } from "./runContext";
import {
    assertSeriesRequest,
    bucketIndexExpression,
    bucketSizeStatements,
    readSeriesBucketSize,
    seriesBucketBounds,
    seriesParameters,
    seriesWindowFilter,
} from "./seriesBuckets";

export interface MetricSeriesConfig {
    /** A runtime stats metric, for example executionCount or memoryConsumption. Not waitTime. */
    readonly metric: QueryStoreMetric;
    readonly start: Date;
    readonly end: Date;
    /** Wanted bucket size, 1 to 1440 minutes. */
    readonly bucketMinutes: number;
    /** Default 1, the primary. */
    readonly replicaGroupId?: number | bigint | string;
}

export interface MetricSeriesBucket {
    /** ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
    /**
     * SUM(avg*count) converted like the reports (ms for times, KB for memory and page metrics);
     * for executionCount, the executions.
     */
    readonly total: number;
    readonly executionCount: number;
    /** MAX of the per-interval max_<metric>, converted. Absent for executionCount. */
    readonly max?: number;
}

export interface MetricSeries {
    readonly metric: QueryStoreMetric;
    /** The bucket size used: the wanted size, or the Query Store interval length when that is longer. */
    readonly bucketMinutes: number;
    /** sys.database_query_store_options.interval_length_minutes. */
    readonly intervalLengthMinutes?: number;
    /**
     * Only buckets with runtime stats, in time order. A runtime stats interval counts in the
     * bucket that contains its start_time. Buckets align to whole multiples of bucketMinutes
     * since 2000-01-01T00:00:00Z.
     */
    readonly buckets: readonly MetricSeriesBucket[];
}

/**
 * Reads one metric of all queries for each time bucket in the window, for a chart. A runtime
 * stats interval counts when it starts in the window, so the first and last buckets can start
 * before the window or end after it. `noData` (with data) when no bucket has runtime stats;
 * `unsupported` when the server does not record the metric.
 */
export async function runQueryStoreMetricSeries(
    reader: SqlReader,
    info: PlatformInfo,
    config: MetricSeriesConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<MetricSeries>> {
    const metric = assertQueryStoreMetric(config.metric);
    if (metric === "waitTime") {
        throw new RangeError("Wait time is not in the runtime stats.");
    }
    assertSeriesRequest(config.start, config.end, config.bucketMinutes);
    const replicaGroupId = formatBigInt(config.replicaGroupId ?? replicaGroupIds.primary);

    return runWithQueryStore<MetricSeries>(
        reader,
        info,
        options,
        { metrics: true, replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes(metric)) {
                return unsupportedOutcome;
            }
            const sql = buildMetricSeriesQuery(
                { ...config, metric },
                context.probe.isQdsRoAvailable ? replicaGroupId : undefined,
            );
            const [sizeSet, bucketSet] = await context.reader.read(
                `${sessionPreamble(context.info, "read")}\n${sql}`,
                context.readOptions,
            );
            const size = readSeriesBucketSize(sizeSet, config.bucketMinutes);
            const buckets: MetricSeriesBucket[] = [];
            for (const record of toRecords(bucketSet)) {
                const bucketIndex = readNumber(record, "bucket_index");
                if (bucketIndex === undefined) {
                    continue;
                }
                const max =
                    metric === "executionCount" ? undefined : readNumber(record, "max_value");
                buckets.push({
                    ...seriesBucketBounds(bucketIndex, size.bucketMinutes),
                    total: readNumber(record, "total") ?? 0,
                    executionCount: readNumber(record, "execution_count") ?? 0,
                    ...(max !== undefined ? { max } : {}),
                });
            }
            const data: MetricSeries = { metric, ...size, buckets };
            return { status: buckets.length > 0 ? "ready" : "noData", data };
        },
    );
}

/**
 * Returns the batch of {@link runQueryStoreMetricSeries}, without the session preamble: the
 * bucket size, and then one row for each bucket with runtime stats. Pass the replica group only
 * when the server has Query Store for secondary replicas. Exported for tests.
 */
export function buildMetricSeriesQuery(
    config: MetricSeriesConfig,
    replicaGroupId?: string,
): string {
    const metric = assertQueryStoreMetric(config.metric);
    if (metric === "waitTime") {
        throw new RangeError("Wait time is not in the runtime stats.");
    }
    assertSeriesRequest(config.start, config.end, config.bucketMinutes);
    const parameters = seriesParameters(config.start, config.end, config.bucketMinutes);
    let replicaFilter = "";
    if (replicaGroupId !== undefined) {
        parameters.push(replicaGroupIdParameter(replicaGroupId));
        replicaFilter = `\n        AND rs.replica_group_id = ${queryStoreParameters.replicaGroupId}`;
    }
    const name = metricQueryString(metric);
    const factor = metricConversionFactor(metric);
    const columns =
        metric === "executionCount"
            ? ["    CONVERT(float, SUM(s.count_executions)) AS total"]
            : [
                  `    CONVERT(float, SUM(s.metric_total)) * ${factor} AS total`,
                  `    CONVERT(float, MAX(s.metric_max)) * ${factor} AS max_value`,
              ];
    const values =
        metric === "executionCount"
            ? ""
            : `\n        rs.avg_${name} * rs.count_executions AS metric_total,\n        rs.max_${name} AS metric_max,`;
    const body = `${bucketSizeStatements}
SELECT
    s.bucket_index,
${columns.join(",\n")},
    SUM(s.count_executions) AS execution_count
FROM (
    SELECT
        ${bucketIndexExpression} AS bucket_index,${values}
        rs.count_executions
    FROM sys.query_store_runtime_stats AS rs
        JOIN sys.query_store_runtime_stats_interval AS rsi
            ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    WHERE ${seriesWindowFilter("        ")}${replicaFilter}
) AS s
GROUP BY s.bucket_index
ORDER BY s.bucket_index;`;
    return prependSqlParameters(body, parameters);
}
