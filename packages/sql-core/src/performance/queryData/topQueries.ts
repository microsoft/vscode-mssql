/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    sqlDateTime2UtcLiteral,
    sqlDateTimeOffsetLiteral,
    sqlIntLiteral,
} from "../../common/literals";
import {
    PlatformInfo,
    hasQueryStore,
    hasQueryStoreWaitsAndLogMetrics,
    isFabricWarehouseFamily,
} from "../../common/platform";
import { maxDopOneHint, sessionPreamble } from "../../common/session";
import { MissingDataCode, PerfResult, PerfSource, errorResult, unsupportedResult } from "../result";
import {
    SqlReadOptions,
    SqlReader,
    SqlRecord,
    readId,
    readNumber,
    readString,
    toRecords,
} from "../../common/sqlReader";

export type TopQueriesMetric =
    | "cpu"
    | "duration"
    | "executions"
    | "logicalReads"
    | "logicalWrites"
    | "physicalReads"
    | "memory"
    | "logBytes"
    | "tempdb"
    | "waitTime"
    | "dataScanned";

export interface TopQueriesRequest {
    readonly metric: TopQueriesMetric;
    readonly start: Date;
    readonly end: Date;
    /** From 1 to 1000. */
    readonly top: number;
}

/**
 * One query, with totals for the requested window. Times are milliseconds. Reads and writes are
 * 8 KB pages. Memory and tempdb are KB.
 */
export interface TopQuery {
    /** Query Store `query_id`, as a decimal string. */
    readonly queryId?: string;
    /** `query_hash`, as hex. */
    readonly queryHash?: string;
    readonly objectName?: string;
    /** The first 512 characters of the query text. */
    readonly textPreview?: string;
    readonly executions: number;
    readonly abortedExecutions?: number;
    readonly failedExecutions?: number;
    readonly planCount?: number;
    readonly lastExecutionTime?: string;
    readonly totalCpuMs?: number;
    readonly totalDurationMs?: number;
    readonly totalLogicalReads?: number;
    readonly totalLogicalWrites?: number;
    readonly totalPhysicalReads?: number;
    readonly totalMemoryKb?: number;
    readonly totalLogBytes?: number;
    readonly totalTempdbKb?: number;
    readonly totalWaitMs?: number;
    readonly totalDataScannedMb?: number;
}

interface TopQueriesPlan {
    readonly source: PerfSource;
    readonly sql: string;
    readonly missing: MissingDataCode[];
    readonly checkQueryStoreState: boolean;
}

const queryStoreOrderColumns: Record<TopQueriesMetric, string | undefined> = {
    cpu: "total_cpu_us",
    duration: "total_duration_us",
    executions: "executions",
    logicalReads: "total_logical_reads",
    logicalWrites: "total_logical_writes",
    physicalReads: "total_physical_reads",
    memory: "total_memory_pages",
    logBytes: "total_log_bytes",
    tempdb: "total_tempdb_pages",
    waitTime: "total_wait_ms",
    dataScanned: undefined,
};

const synapseDedicatedOrderColumns: Partial<Record<TopQueriesMetric, string>> = {
    duration: "total_duration_us",
    executions: "executions",
};

const queryInsightsOrderColumns: Partial<Record<TopQueriesMetric, string>> = {
    cpu: "total_cpu_ms",
    duration: "total_duration_ms",
    executions: "executions",
    dataScanned: "total_data_scanned_mb",
};

function queryStoreStateQuery(info: PlatformInfo): string {
    return `
${sessionPreamble(info)}
SELECT actual_state_desc FROM sys.database_query_store_options;
`;
}

/**
 * Builds the T-SQL for the top queries, or returns undefined when the platform or the metric is
 * not supported. Exported for tests.
 */
export function buildTopQueriesPlan(
    info: PlatformInfo,
    request: TopQueriesRequest,
): TopQueriesPlan | undefined {
    validateRequest(request);
    const top = sqlIntLiteral(request.top, 1, 1000);

    if (hasQueryStore(info)) {
        const extended = hasQueryStoreWaitsAndLogMetrics(info);
        const orderColumn = queryStoreOrderColumns[request.metric];
        const needsExtended =
            request.metric === "waitTime" ||
            request.metric === "logBytes" ||
            request.metric === "tempdb";
        if (!orderColumn || (needsExtended && !extended)) {
            return undefined;
        }
        return {
            source: "queryStore",
            sql: buildQueryStoreSql(info, request, top, orderColumn, extended),
            missing: extended ? [] : ["queryStoreWaitStats", "queryStoreLogAndTempdbMetrics"],
            checkQueryStoreState: true,
        };
    }

    if (info.platform === "synapseDedicated") {
        const orderColumn = synapseDedicatedOrderColumns[request.metric];
        if (!orderColumn) {
            return undefined;
        }
        return {
            source: "queryStore",
            sql: buildSynapseDedicatedSql(info, request, top, orderColumn),
            missing: ["cpuReadsAndMemory", "queryStoreWaitStats"],
            checkQueryStoreState: true,
        };
    }

    if (isFabricWarehouseFamily(info)) {
        const orderColumn = queryInsightsOrderColumns[request.metric];
        if (!orderColumn) {
            return undefined;
        }
        return {
            source: "queryInsights",
            sql: buildQueryInsightsSql(info, request, top, orderColumn),
            missing: [],
            checkQueryStoreState: false,
        };
    }

    // Synapse serverless keeps query history only in Azure Monitor logs.
    return undefined;
}

/**
 * Reads the queries with the highest total of the requested metric in the window.
 */
export async function getTopQueries(
    reader: SqlReader,
    info: PlatformInfo,
    request: TopQueriesRequest,
    options?: SqlReadOptions,
    now: Date = new Date(),
): Promise<PerfResult<TopQuery[]>> {
    const plan = buildTopQueriesPlan(info, request);
    if (!plan) {
        return unsupportedResult(info, now);
    }

    try {
        if (plan.checkQueryStoreState) {
            const [stateSet] = await reader.read(queryStoreStateQuery(info), options);
            const state = readString(toRecords(stateSet)[0] ?? {}, "actual_state_desc");
            if (!state || state.toUpperCase() === "OFF") {
                return {
                    status: "notConfigured",
                    platform: info.platform,
                    source: plan.source,
                    scope: "database",
                    observedAtUtc: now.toISOString(),
                    missing: [],
                };
            }
        }

        const [resultSet] = await reader.read(plan.sql, options);
        const queries = toRecords(resultSet).map((record) => toTopQuery(record, plan.source));
        return {
            status: queries.length > 0 ? "ready" : "noData",
            platform: info.platform,
            source: plan.source,
            scope: "database",
            observedAtUtc: now.toISOString(),
            data: queries,
            missing: plan.missing,
        };
    } catch (error) {
        return errorResult(info, error, now, plan.source);
    }
}

function validateRequest(request: TopQueriesRequest): void {
    if (request.start.getTime() >= request.end.getTime()) {
        throw new RangeError("The start of the window must be before the end.");
    }
}

function buildQueryStoreSql(
    info: PlatformInfo,
    request: TopQueriesRequest,
    top: string,
    orderColumn: string,
    extended: boolean,
): string {
    const logAndTempdb = extended
        ? `
        SUM(rs.avg_log_bytes_used * rs.count_executions) AS total_log_bytes,
        SUM(rs.avg_tempdb_space_used * rs.count_executions) AS total_tempdb_pages,`
        : "";
    const logAndTempdbColumns = extended
        ? "\n    r.total_log_bytes,\n    r.total_tempdb_pages,"
        : "";
    // Idle (11) and user wait (18) categories are not query work.
    const waits = extended
        ? `,
waits AS (
    SELECT p.query_id, SUM(ws.total_query_wait_time_ms) AS total_wait_ms
    FROM sys.query_store_wait_stats AS ws
    INNER JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = ws.runtime_stats_interval_id
    INNER JOIN sys.query_store_plan AS p ON p.plan_id = ws.plan_id
    WHERE rsi.start_time < @end AND rsi.end_time > @start
        AND ws.wait_category NOT IN (11, 18)
    GROUP BY p.query_id
)`
        : "";
    const waitColumn = extended ? ",\n    ISNULL(w.total_wait_ms, 0) AS total_wait_ms" : "";
    const waitJoin = extended ? "\nLEFT JOIN waits AS w ON w.query_id = r.query_id" : "";
    const orderBy =
        orderColumn === "total_wait_ms" ? "ISNULL(w.total_wait_ms, 0)" : `r.${orderColumn}`;

    return `
${sessionPreamble(info)}
DECLARE @start datetimeoffset = ${sqlDateTimeOffsetLiteral(request.start)};
DECLARE @end datetimeoffset = ${sqlDateTimeOffsetLiteral(request.end)};
WITH runtime AS (
    SELECT
        p.query_id,
        SUM(rs.count_executions) AS executions,
        SUM(CASE WHEN rs.execution_type = 3 THEN rs.count_executions ELSE 0 END) AS aborted_executions,
        SUM(CASE WHEN rs.execution_type = 4 THEN rs.count_executions ELSE 0 END) AS failed_executions,
        SUM(rs.avg_cpu_time * rs.count_executions) AS total_cpu_us,
        SUM(rs.avg_duration * rs.count_executions) AS total_duration_us,
        SUM(rs.avg_logical_io_reads * rs.count_executions) AS total_logical_reads,
        SUM(rs.avg_logical_io_writes * rs.count_executions) AS total_logical_writes,
        SUM(rs.avg_physical_io_reads * rs.count_executions) AS total_physical_reads,
        SUM(rs.avg_query_max_used_memory * rs.count_executions) AS total_memory_pages,${logAndTempdb}
        COUNT(DISTINCT p.plan_id) AS plan_count,
        MAX(rs.last_execution_time) AS last_execution_time
    FROM sys.query_store_runtime_stats AS rs
    INNER JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    INNER JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
    WHERE rsi.start_time < @end AND rsi.end_time > @start
    GROUP BY p.query_id
)${waits}
SELECT TOP (${top})
    CONVERT(varchar(20), r.query_id) AS query_id,
    CONVERT(varchar(18), q.query_hash, 1) AS query_hash,
    OBJECT_SCHEMA_NAME(q.object_id) + N'.' + OBJECT_NAME(q.object_id) AS object_name,
    LEFT(qt.query_sql_text, 512) AS text_preview,
    r.executions,
    r.aborted_executions,
    r.failed_executions,
    r.total_cpu_us,
    r.total_duration_us,
    r.total_logical_reads,
    r.total_logical_writes,
    r.total_physical_reads,
    r.total_memory_pages,${logAndTempdbColumns}
    r.plan_count,
    r.last_execution_time${waitColumn}
FROM runtime AS r
INNER JOIN sys.query_store_query AS q ON q.query_id = r.query_id
INNER JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id${waitJoin}
ORDER BY ${orderBy} DESC${maxDopOneHint(info)};
`;
}

function buildSynapseDedicatedSql(
    info: PlatformInfo,
    request: TopQueriesRequest,
    top: string,
    orderColumn: string,
): string {
    // Synapse returns 0 for the CPU, I/O, memory, log, and row columns. Read only the valid ones.
    return `
${sessionPreamble(info)}
DECLARE @start datetimeoffset = ${sqlDateTimeOffsetLiteral(request.start)};
DECLARE @end datetimeoffset = ${sqlDateTimeOffsetLiteral(request.end)};
WITH runtime AS (
    SELECT
        p.query_id,
        SUM(rs.count_executions) AS executions,
        SUM(rs.avg_duration * rs.count_executions) AS total_duration_us,
        COUNT(DISTINCT p.plan_id) AS plan_count,
        MAX(rs.last_execution_time) AS last_execution_time
    FROM sys.query_store_runtime_stats AS rs
    INNER JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    INNER JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
    WHERE rsi.start_time < @end AND rsi.end_time > @start
    GROUP BY p.query_id
)
SELECT TOP (${top})
    CONVERT(varchar(20), r.query_id) AS query_id,
    LEFT(qt.query_sql_text, 512) AS text_preview,
    r.executions,
    r.total_duration_us,
    r.plan_count,
    r.last_execution_time
FROM runtime AS r
INNER JOIN sys.query_store_query AS q ON q.query_id = r.query_id
INNER JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
ORDER BY r.${orderColumn} DESC;
`;
}

function buildQueryInsightsSql(
    info: PlatformInfo,
    request: TopQueriesRequest,
    top: string,
    orderColumn: string,
): string {
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

function toTopQuery(record: SqlRecord, source: PerfSource): TopQuery {
    if (source === "queryInsights") {
        return {
            queryHash: readString(record, "query_hash"),
            textPreview: readString(record, "text_preview"),
            executions: readNumber(record, "executions") ?? 0,
            failedExecutions: readNumber(record, "failed_executions"),
            lastExecutionTime: readString(record, "last_execution_time"),
            totalCpuMs: readNumber(record, "total_cpu_ms"),
            totalDurationMs: readNumber(record, "total_duration_ms"),
            totalDataScannedMb: readNumber(record, "total_data_scanned_mb"),
        };
    }
    return {
        queryId: readId(record, "query_id"),
        queryHash: readString(record, "query_hash"),
        objectName: readString(record, "object_name"),
        textPreview: readString(record, "text_preview"),
        executions: readNumber(record, "executions") ?? 0,
        abortedExecutions: readNumber(record, "aborted_executions"),
        failedExecutions: readNumber(record, "failed_executions"),
        planCount: readNumber(record, "plan_count"),
        lastExecutionTime: readString(record, "last_execution_time"),
        totalCpuMs: microsecondsToMs(readNumber(record, "total_cpu_us")),
        totalDurationMs: microsecondsToMs(readNumber(record, "total_duration_us")),
        totalLogicalReads: readNumber(record, "total_logical_reads"),
        totalLogicalWrites: readNumber(record, "total_logical_writes"),
        totalPhysicalReads: readNumber(record, "total_physical_reads"),
        totalMemoryKb: pagesToKb(readNumber(record, "total_memory_pages")),
        totalLogBytes: readNumber(record, "total_log_bytes"),
        totalTempdbKb: pagesToKb(readNumber(record, "total_tempdb_pages")),
        totalWaitMs: readNumber(record, "total_wait_ms"),
    };
}

function microsecondsToMs(value: number | undefined): number | undefined {
    return value === undefined ? undefined : value / 1000;
}

function pagesToKb(value: number | undefined): number | undefined {
    return value === undefined ? undefined : value * 8;
}
