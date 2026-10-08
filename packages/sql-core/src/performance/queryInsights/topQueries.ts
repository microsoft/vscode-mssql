/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlDateTime2UtcLiteral, sqlIntLiteral } from "../../common/literals";
import { PlatformInfo, isFabricWarehouseFamily } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import {
    SqlReader,
    SqlRecord,
    readDateTime,
    readNumber,
    readString,
    toRecords,
} from "../../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "../result";
import { PerfRunOptions, readOptionsOf } from "../runOptions";

/*
 * Top queries from Query Insights, for Fabric Data Warehouse and the SQL analytics endpoint. The
 * Query Store platforms use the Query Store run functions, such as
 * runTopResourceConsumersSummary.
 */

export type QueryInsightsMetric = "cpu" | "duration" | "executions" | "dataScanned";

export interface QueryInsightsTopQueriesRequest {
    readonly metric: QueryInsightsMetric;
    readonly start: Date;
    readonly end: Date;
    /** From 1 to 1000. */
    readonly top: number;
}

/** One query shape (`query_hash`), with totals for the window. Times are milliseconds. */
export interface QueryInsightsTopQuery {
    /** `query_hash`, as Query Insights returns it. */
    readonly queryHash?: string;
    /** The first 512 characters of the command. */
    readonly textPreview?: string;
    readonly executions: number;
    readonly failedExecutions?: number;
    /** ISO 8601 UTC. */
    readonly lastExecutionTime?: string;
    readonly totalCpuMs?: number;
    readonly totalDurationMs?: number;
    readonly totalDataScannedMb?: number;
}

const orderColumns: Readonly<Record<QueryInsightsMetric, string>> = {
    cpu: "total_cpu_ms",
    duration: "total_duration_ms",
    executions: "executions",
    dataScanned: "total_data_scanned_mb",
};

/**
 * Returns the T-SQL for the queries with the highest total of the metric in the window. Throws a
 * `RangeError` for a window or a row count that is not valid, or a metric that Query Insights does
 * not have. Exported for tests.
 */
export function buildQueryInsightsTopQueriesQuery(
    info: PlatformInfo,
    request: QueryInsightsTopQueriesRequest,
): string {
    if (request.start.getTime() >= request.end.getTime()) {
        throw new RangeError("The start of the window must be before the end.");
    }
    const top = sqlIntLiteral(request.top, 1, 1000);
    if (!Object.prototype.hasOwnProperty.call(orderColumns, request.metric)) {
        throw new RangeError(`"${String(request.metric)}" is not a Query Insights metric.`);
    }
    const orderColumn = orderColumns[request.metric];
    // Query Insights stores UTC times as datetime2. A query can appear 15 minutes or more after
    // it ends.
    return `
${sessionPreamble(info)}
DECLARE @start datetime2 = ${sqlDateTime2UtcLiteral(request.start)};
DECLARE @end datetime2 = ${sqlDateTime2UtcLiteral(request.end)};
SELECT TOP (${top})
    query_hash,
    COUNT(*) AS executions,
    SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) AS failed_executions,
    SUM(CAST(total_elapsed_time_ms AS bigint)) AS total_duration_ms,
    SUM(CAST(allocated_cpu_time_ms AS bigint)) AS total_cpu_ms,
    SUM(data_scanned_remote_storage_mb + data_scanned_memory_mb + data_scanned_disk_mb)
        AS total_data_scanned_mb,
    MAX(end_time) AS last_execution_time,
    MIN(LEFT(command, 512)) AS text_preview
FROM queryinsights.exec_requests_history
WHERE start_time < @end AND end_time > @start
GROUP BY query_hash
ORDER BY ${orderColumn} DESC;
`;
}

/**
 * Reads the queries with the highest total of the metric in the window from Query Insights.
 * Fabric Data Warehouse and the SQL analytics endpoint only; other platforms give `unsupported`.
 */
export async function runQueryInsightsTopQueries(
    reader: SqlReader,
    info: PlatformInfo,
    request: QueryInsightsTopQueriesRequest,
    options: PerfRunOptions = {},
): Promise<PerfResult<QueryInsightsTopQuery[]>> {
    const now = options.now ?? new Date();
    const sql = buildQueryInsightsTopQueriesQuery(info, request);
    if (!isFabricWarehouseFamily(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const [resultSet] = await reader.read(sql, readOptionsOf(options));
        const queries = toRecords(resultSet).map(toTopQuery);
        return {
            status: queries.length > 0 ? "ready" : "noData",
            platform: info.platform,
            source: "queryInsights",
            scope: "item",
            observedAtUtc: now.toISOString(),
            data: queries,
            missing: [],
        };
    } catch (error) {
        return errorResult(info, error, now, "queryInsights");
    }
}

function toTopQuery(record: SqlRecord): QueryInsightsTopQuery {
    return {
        queryHash: readString(record, "query_hash"),
        textPreview: readString(record, "text_preview"),
        executions: readNumber(record, "executions") ?? 0,
        failedExecutions: readNumber(record, "failed_executions"),
        lastExecutionTime: readDateTime(record, "last_execution_time"),
        totalCpuMs: readNumber(record, "total_cpu_ms"),
        totalDurationMs: readNumber(record, "total_duration_ms"),
        totalDataScannedMb: readNumber(record, "total_data_scanned_mb"),
    };
}
