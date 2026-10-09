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
import {
    QueryStoreSqlParameter,
    formatBigInt,
    prependSqlParameters,
} from "../queryStore/common/sqlParameters";
import { assertValidDate } from "../queryStore/common/timeInterval";
import { QueryStoreRunOptions, runWithQueryStore, unsupportedOutcome } from "./runContext";

export interface MetricTotalsWindow {
    readonly start: Date;
    readonly end: Date;
}

export interface MetricTotalsConfig {
    /** A metric of `sys.query_store_runtime_stats`, for example `cpuTime`. Not `waitTime`. */
    readonly metric: QueryStoreMetric;
    /** One to 16 windows. The start of each window is before its end. */
    readonly windows: readonly MetricTotalsWindow[];
    /** Default 1, the primary. */
    readonly replicaGroupId?: number | bigint | string;
}

export interface MetricWindowTotal {
    /** ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
    /**
     * The total of the metric, in the unit of the reports: milliseconds for times, KB for
     * pages and log. For `executionCount`, the executions.
     */
    readonly total: number;
    readonly executionCount: number;
}

export interface MetricTotals {
    readonly metric: QueryStoreMetric;
    readonly windows: readonly MetricWindowTotal[];
}

const maxWindows = 16;

/**
 * Totals one metric over each window, for example the CPU time of the last 24 hours and of the
 * 24 hours before. A runtime stats interval counts in a window when it starts in the window, so
 * an edge of a window can move by up to one interval (one hour by default). `noData` when no
 * window has executions; `unsupported` when the server does not record the metric.
 */
export async function runQueryStoreMetricTotals(
    reader: SqlReader,
    info: PlatformInfo,
    config: MetricTotalsConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<MetricTotals>> {
    const metric = assertQueryStoreMetric(config.metric);
    if (metric === "waitTime") {
        throw new RangeError("Wait time is not in the runtime stats.");
    }
    if (config.windows.length === 0 || config.windows.length > maxWindows) {
        throw new RangeError(`A metric total needs 1 to ${maxWindows} windows.`);
    }
    for (const window of config.windows) {
        assertValidDate(window.start);
        assertValidDate(window.end);
        if (window.start.getTime() >= window.end.getTime()) {
            throw new RangeError("The start of a window must be before its end.");
        }
    }
    const replicaGroupId = formatBigInt(config.replicaGroupId ?? replicaGroupIds.primary);

    return runWithQueryStore<MetricTotals>(
        reader,
        info,
        options,
        { metrics: true, replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes(metric)) {
                return unsupportedOutcome;
            }
            const sql = buildMetricTotalsQuery(
                metric,
                config.windows,
                context.probe.isQdsRoAvailable ? replicaGroupId : undefined,
            );
            const [resultSet] = await context.reader.read(
                `${sessionPreamble(context.info, "read")}\n${sql}`,
                context.readOptions,
            );
            const record = toRecords(resultSet)[0];
            const windows = config.windows.map((window, index) => ({
                startUtc: window.start.toISOString(),
                endUtc: window.end.toISOString(),
                total: (record && readNumber(record, `total_${index}`)) ?? 0,
                executionCount: (record && readNumber(record, `executions_${index}`)) ?? 0,
            }));
            const data: MetricTotals = { metric, windows };
            return windows.some((window) => window.executionCount > 0)
                ? { status: "ready", data }
                : { status: "noData", data };
        },
    );
}

/**
 * Returns the batch of {@link runQueryStoreMetricTotals}, without the session preamble. Pass the
 * replica group only when the server has Query Store for secondary replicas. Exported for tests.
 */
export function buildMetricTotalsQuery(
    metric: QueryStoreMetric,
    windows: readonly MetricTotalsWindow[],
    replicaGroupId?: string,
): string {
    const parameters: QueryStoreSqlParameter[] = [];
    const columns: string[] = [];
    windows.forEach((window, index) => {
        const start = `@window_${index}_start`;
        const end = `@window_${index}_end`;
        parameters.push(
            { name: start, type: "datetimeoffset", value: window.start },
            { name: end, type: "datetimeoffset", value: window.end },
        );
        const inWindow = `rsi.start_time >= ${start} AND rsi.start_time < ${end}`;
        const value =
            metric === "executionCount"
                ? "rs.count_executions"
                : `rs.avg_${metricQueryString(metric)} * rs.count_executions`;
        const factor = metric === "executionCount" ? 1 : metricConversionFactor(metric);
        columns.push(
            `    CONVERT(float, SUM(CASE WHEN ${inWindow} THEN ${value} ELSE 0 END)) * ${factor} AS total_${index}`,
            `    SUM(CASE WHEN ${inWindow} THEN rs.count_executions ELSE 0 END) AS executions_${index}`,
        );
    });
    parameters.push(
        {
            name: "@range_start",
            type: "datetimeoffset",
            value: new Date(Math.min(...windows.map((window) => window.start.getTime()))),
        },
        {
            name: "@range_end",
            type: "datetimeoffset",
            value: new Date(Math.max(...windows.map((window) => window.end.getTime()))),
        },
    );
    let replicaFilter = "";
    if (replicaGroupId !== undefined) {
        parameters.push(replicaGroupIdParameter(replicaGroupId));
        replicaFilter = `\n    AND rs.replica_group_id = ${queryStoreParameters.replicaGroupId}`;
    }
    const body = `SELECT
${columns.join(",\n")}
FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
WHERE rsi.start_time >= @range_start
    AND rsi.start_time < @range_end${replicaFilter};`;
    return prependSqlParameters(body, parameters);
}
