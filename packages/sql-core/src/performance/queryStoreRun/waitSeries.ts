/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo, hasQueryStoreWaitsAndLogMetrics } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import { SqlReader, readNumber, toRecords } from "../../common/sqlReader";
import { PerfResult, unsupportedResult } from "../result";
import { queryStoreParameters } from "../queryStore/common/queryGeneratorUtils";
import { replicaGroupIds } from "../queryStore/common/replicaGroup";
import { replicaGroupIdParameter } from "../queryStore/common/reportParameters";
import {
    QueryStoreSqlParameter,
    formatBigInt,
    prependSqlParameters,
} from "../queryStore/common/sqlParameters";
import { assertValidDate } from "../queryStore/common/timeInterval";
import { MetricTotalsWindow } from "./metricTotals";
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

export interface WaitSeriesConfig {
    /** sys.query_store_wait_stats.wait_category, for example 3 for Lock. */
    readonly waitCategoryId: number;
    readonly start: Date;
    readonly end: Date;
    /** Wanted bucket size, 1 to 1440 minutes. */
    readonly bucketMinutes: number;
    /** Optional extra windows to total, for example the last 24 hours and the 24 hours before. Max 16. */
    readonly windows?: readonly MetricTotalsWindow[];
    /** Default 1, the primary. */
    readonly replicaGroupId?: number | bigint | string;
}

export interface WaitSeriesBucket {
    /** ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
    readonly totalWaitMs: number;
}

export interface WaitSeries {
    readonly waitCategoryId: number;
    /** The bucket size used: the wanted size, or the Query Store interval length when that is longer. */
    readonly bucketMinutes: number;
    /** sys.database_query_store_options.interval_length_minutes. */
    readonly intervalLengthMinutes?: number;
    /** Only buckets with wait stats, in time order. The buckets are the same as in a metric series. */
    readonly buckets: readonly WaitSeriesBucket[];
    /** One total for each config window, in order. */
    readonly windowTotals: readonly {
        readonly startUtc: string;
        readonly endUtc: string;
        readonly totalWaitMs: number;
    }[];
}

/** The `wait_category` of lock waits. */
export const queryStoreLockWaitCategoryId = 3;

const maxWindows = 16;
const maxWaitCategoryId = 32767;

/**
 * Reads the wait time of one wait category for each time bucket in the window, and its total in
 * each extra window. The buckets and the windows use the rules of `runQueryStoreMetricSeries`: a
 * runtime stats interval counts when it starts in the window or bucket. `noData` (with data)
 * when no bucket and no window has wait time. `unsupported` where Query Store has no wait stats:
 * SQL Server 2016, Synapse, and the platforms without Query Store.
 */
export async function runQueryStoreWaitSeries(
    reader: SqlReader,
    info: PlatformInfo,
    config: WaitSeriesConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<WaitSeries>> {
    assertWaitSeriesConfig(config);
    const replicaGroupId = formatBigInt(config.replicaGroupId ?? replicaGroupIds.primary);
    if (!hasQueryStoreWaitsAndLogMetrics(info)) {
        return unsupportedResult(info, options.now ?? new Date());
    }
    const windows = config.windows ?? [];

    return runWithQueryStore<WaitSeries>(
        reader,
        info,
        options,
        { metrics: true, replicaGroupId, synapseDedicated: false },
        async (context) => {
            if (!context.probe.availableMetrics.includes("waitTime")) {
                return unsupportedOutcome;
            }
            const sql = buildWaitSeriesQuery(
                config,
                context.probe.isQdsRoAvailable ? replicaGroupId : undefined,
            );
            const [sizeSet, bucketSet, windowSet] = await context.reader.read(
                `${sessionPreamble(context.info, "read")}\n${sql}`,
                context.readOptions,
            );
            const size = readSeriesBucketSize(sizeSet, config.bucketMinutes);
            const buckets: WaitSeriesBucket[] = [];
            for (const record of toRecords(bucketSet)) {
                const bucketIndex = readNumber(record, "bucket_index");
                if (bucketIndex !== undefined) {
                    buckets.push({
                        ...seriesBucketBounds(bucketIndex, size.bucketMinutes),
                        totalWaitMs: readNumber(record, "total_wait_ms") ?? 0,
                    });
                }
            }
            const totals = toRecords(windowSet)[0];
            const windowTotals = windows.map((window, index) => ({
                startUtc: window.start.toISOString(),
                endUtc: window.end.toISOString(),
                totalWaitMs: (totals && readNumber(totals, `total_${index}`)) ?? 0,
            }));
            const data: WaitSeries = {
                waitCategoryId: config.waitCategoryId,
                ...size,
                buckets,
                windowTotals,
            };
            const hasWaits =
                buckets.length > 0 || windowTotals.some((window) => window.totalWaitMs > 0);
            return { status: hasWaits ? "ready" : "noData", data };
        },
    );
}

/**
 * Returns the batch of {@link runQueryStoreWaitSeries}, without the session preamble: the bucket
 * size, one row for each bucket with wait time, and, when the config has windows, one row with a
 * total for each window. Pass the replica group only when the server has Query Store for
 * secondary replicas. Exported for tests.
 */
export function buildWaitSeriesQuery(config: WaitSeriesConfig, replicaGroupId?: string): string {
    assertWaitSeriesConfig(config);
    const windows = config.windows ?? [];
    const parameters: QueryStoreSqlParameter[] = [
        ...seriesParameters(config.start, config.end, config.bucketMinutes),
        { name: queryStoreParameters.waitCategoryId, type: "int", value: config.waitCategoryId },
    ];
    if (replicaGroupId !== undefined) {
        parameters.push(replicaGroupIdParameter(replicaGroupId));
    }
    const replicaFilter = (indent: string) =>
        replicaGroupId === undefined
            ? ""
            : `\n${indent}AND ws.replica_group_id = ${queryStoreParameters.replicaGroupId}`;
    const statements = [
        bucketSizeStatements,
        `SELECT
    s.bucket_index,
    CONVERT(float, SUM(s.total_query_wait_time_ms)) AS total_wait_ms
FROM (
    SELECT
        ${bucketIndexExpression} AS bucket_index,
        ws.total_query_wait_time_ms
    FROM sys.query_store_wait_stats AS ws
        JOIN sys.query_store_runtime_stats_interval AS rsi
            ON rsi.runtime_stats_interval_id = ws.runtime_stats_interval_id
    WHERE ws.wait_category = ${queryStoreParameters.waitCategoryId}
        AND ${seriesWindowFilter("        ")}${replicaFilter("        ")}
) AS s
GROUP BY s.bucket_index
ORDER BY s.bucket_index;`,
    ];
    if (windows.length > 0) {
        const columns: string[] = [];
        windows.forEach((window, index) => {
            const start = `@window_${index}_start`;
            const end = `@window_${index}_end`;
            parameters.push(
                { name: start, type: "datetimeoffset", value: window.start },
                { name: end, type: "datetimeoffset", value: window.end },
            );
            columns.push(
                `    CONVERT(float, SUM(CASE WHEN rsi.start_time >= ${start} AND rsi.start_time < ${end} THEN ws.total_query_wait_time_ms ELSE 0 END)) AS total_${index}`,
            );
        });
        parameters.push(
            {
                name: "@windows_start",
                type: "datetimeoffset",
                value: new Date(Math.min(...windows.map((window) => window.start.getTime()))),
            },
            {
                name: "@windows_end",
                type: "datetimeoffset",
                value: new Date(Math.max(...windows.map((window) => window.end.getTime()))),
            },
        );
        statements.push(`SELECT
${columns.join(",\n")}
FROM sys.query_store_wait_stats AS ws
    JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE ws.wait_category = ${queryStoreParameters.waitCategoryId}
    AND rsi.start_time >= @windows_start
    AND rsi.start_time < @windows_end${replicaFilter("    ")};`);
    }
    return prependSqlParameters(statements.join("\n"), parameters);
}

function assertWaitSeriesConfig(config: WaitSeriesConfig): void {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    const id = config.waitCategoryId;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > maxWaitCategoryId) {
        throw new RangeError(`${String(id)} is not a wait category ID.`);
    }
    assertSeriesRequest(config.start, config.end, config.bucketMinutes);
    const windows = config.windows ?? [];
    if (windows.length > maxWindows) {
        throw new RangeError(`A wait series takes up to ${maxWindows} windows.`);
    }
    for (const window of windows) {
        assertValidDate(window.start);
        assertValidDate(window.end);
        if (window.start.getTime() >= window.end.getTime()) {
            throw new RangeError("The start of a window must be before its end.");
        }
    }
}
