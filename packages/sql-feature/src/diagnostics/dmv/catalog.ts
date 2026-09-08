/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CatalogQuery } from "../../core/catalog";
import type { ServerCapabilities } from "../../core/platform";

/** Everywhere the execution DMVs behave normally. */
const EXEC_DMV_PLATFORMS = [
    "sqlServer",
    "managedInstance",
    "azureSqlDatabase",
    "sqlEdge",
    "fabric",
] as const;
/** Where server-scoped DMVs exist at all. */
const SERVER_SCOPED = ["sqlServer", "managedInstance", "sqlEdge"] as const;

function executionPermission(capabilities: ServerCapabilities): string {
    return capabilities.platform === "azureSqlDatabase" || capabilities.platform === "fabric"
        ? "VIEW DATABASE STATE"
        : "VIEW SERVER STATE";
}

/**
 * Default investigation filter. Exclusion is reversible and is not proof a wait is harmless.
 */
const BENIGN_WAITS = [
    "BROKER_EVENTHANDLER",
    "SOS_WORK_DISPATCHER",
    "XE_LIVE_TARGET_TVF",
    "BROKER_RECEIVE_WAITFOR",
    "BROKER_TASK_STOP",
    "BROKER_TO_FLUSH",
    "BROKER_TRANSMITTER",
    "CHECKPOINT_QUEUE",
    "CHKPT",
    "CLR_AUTO_EVENT",
    "CLR_MANUAL_EVENT",
    "CLR_SEMAPHORE",
    "DBMIRROR_DBM_EVENT",
    "DBMIRROR_EVENTS_QUEUE",
    "DBMIRROR_WORKER_QUEUE",
    "DBMIRRORING_CMD",
    "DIRTY_PAGE_POLL",
    "DISPATCHER_QUEUE_SEMAPHORE",
    "EXECSYNC",
    "FSAGENT",
    "FT_IFTS_SCHEDULER_IDLE_WAIT",
    "FT_IFTSHC_MUTEX",
    "HADR_CLUSAPI_CALL",
    "HADR_FILESTREAM_IOMGR_IOCOMPLETION",
    "HADR_LOGCAPTURE_WAIT",
    "HADR_NOTIFICATION_DEQUEUE",
    "HADR_TIMER_TASK",
    "HADR_WORK_QUEUE",
    "KSOURCE_WAKEUP",
    "LAZYWRITER_SLEEP",
    "LOGMGR_QUEUE",
    "MEMORY_ALLOCATION_EXT",
    "ONDEMAND_TASK_QUEUE",
    "PARALLEL_REDO_DRAIN_WORKER",
    "PARALLEL_REDO_LOG_CACHE",
    "PARALLEL_REDO_TRAN_LIST",
    "PARALLEL_REDO_WORKER_SYNC",
    "PARALLEL_REDO_WORKER_WAIT_WORK",
    "PREEMPTIVE_XE_GETTARGETSTATE",
    "PWAIT_ALL_COMPONENTS_INITIALIZED",
    "PWAIT_DIRECTLOGCONSUMER_GETNEXT",
    "QDS_PERSIST_TASK_MAIN_LOOP_SLEEP",
    "QDS_ASYNC_QUEUE",
    "QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP",
    "QDS_SHUTDOWN_QUEUE",
    "REDO_THREAD_PENDING_WORK",
    "REQUEST_FOR_DEADLOCK_SEARCH",
    "RESOURCE_QUEUE",
    "SERVER_IDLE_CHECK",
    "SLEEP_BPOOL_FLUSH",
    "SLEEP_DBSTARTUP",
    "SLEEP_DCOMSTARTUP",
    "SLEEP_MASTERDBREADY",
    "SLEEP_MASTERMDREADY",
    "SLEEP_MASTERUPGRADED",
    "SLEEP_MSDBSTARTUP",
    "SLEEP_SYSTEMTASK",
    "SLEEP_TASK",
    "SLEEP_TEMPDBSTARTUP",
    "SNI_HTTP_ACCEPT",
    "SP_SERVER_DIAGNOSTICS_SLEEP",
    "SQLTRACE_BUFFER_FLUSH",
    "SQLTRACE_INCREMENTAL_FLUSH_SLEEP",
    "SQLTRACE_WAIT_ENTRIES",
    "WAIT_FOR_RESULTS",
    "WAITFOR",
    "WAITFOR_TASKSHUTDOWN",
    "WAIT_XTP_RECOVERY",
    "WAIT_XTP_HOST_WAIT",
    "WAIT_XTP_OFFLINE_CKPT_NEW_LOG",
    "WAIT_XTP_CKPT_CLOSE",
    "XE_DISPATCHER_JOIN",
    "XE_DISPATCHER_WAIT",
    "XE_TIMER_EVENT",
]
    .map((w) => `'${w}'`)
    .join(", ");

/** Clamps a caller-supplied row limit so a parameter can never shape the query beyond a number. */
function topN(params: Readonly<Record<string, unknown>> | undefined, fallback: number): number {
    const raw = params?.top;
    const n = typeof raw === "number" ? Math.floor(raw) : Number.NaN;
    return Number.isFinite(n) && n > 0 && n <= 1000 ? n : fallback;
}

export const activeRequests: CatalogQuery = {
    id: "dmv.activeRequests",
    title: "Active requests",
    description:
        "What is executing right now, who is blocking whom, and what each request is waiting on.",
    platforms: [...EXEC_DMV_PLATFORMS],
    requiresCapability: "hasExecutionDmvs",
    requiresPermission: "VIEW SERVER STATE",
    permissionFor: executionPermission,
    columns: [
        { field: "session_id", header: "Session", format: "number", width: 80 },
        { field: "blocking_session_id", header: "Blocked by", format: "number", width: 100 },
        { field: "status", header: "Status", width: 100 },
        { field: "wait_type", header: "Wait type", width: 140 },
        { field: "wait_time_ms", header: "Wait", format: "duration-ms", width: 90 },
        { field: "elapsed_ms", header: "Elapsed", format: "duration-ms", width: 90 },
        { field: "cpu_time_ms", header: "CPU", format: "duration-ms", width: 80 },
        { field: "logical_reads", header: "Reads", format: "number", width: 100 },
        { field: "login_name", header: "Login", width: 120 },
        { field: "program_name", header: "Application", width: 160 },
        { field: "database_name", header: "Database", width: 120 },
        { field: "sql_text", header: "Statement", wide: true },
    ],
    sql: () => `
SELECT TOP (200)
    r.session_id,
    NULLIF(r.blocking_session_id, 0) AS blocking_session_id,
    r.status,
    r.wait_type,
    r.wait_time            AS wait_time_ms,
    r.total_elapsed_time   AS elapsed_ms,
    r.cpu_time             AS cpu_time_ms,
    r.logical_reads,
    s.login_name,
    s.program_name,
    DB_NAME(r.database_id) AS database_name,
    SUBSTRING(t.text,
        (r.statement_start_offset / 2) + 1,
        ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE r.statement_end_offset END
          - r.statement_start_offset) / 2) + 1) AS sql_text
FROM sys.dm_exec_requests AS r
JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
WHERE r.session_id <> @@SPID AND s.is_user_process = 1
ORDER BY r.total_elapsed_time DESC`,
};

export const overview: CatalogQuery = {
    id: "dmv.overview",
    title: "Activity overview",
    description: "A bounded observation of current requests, blocking, CPU and logical reads.",
    platforms: [...EXEC_DMV_PLATFORMS],
    requiresCapability: "hasExecutionDmvs",
    requiresPermission: "VIEW SERVER STATE",
    permissionFor: executionPermission,
    columns: [
        { field: "active_requests", header: "Active requests", format: "number", width: 130 },
        { field: "blocked_requests", header: "Blocked requests", format: "number", width: 140 },
        { field: "total_cpu_ms", header: "CPU", format: "duration-ms", width: 100 },
        { field: "total_logical_reads", header: "Reads", format: "number", width: 110 },
        {
            field: "longest_elapsed_ms",
            header: "Longest elapsed",
            format: "duration-ms",
            width: 140,
        },
        { field: "observed_at", header: "Observed", format: "datetime", width: 170 },
    ],
    sql: () => `
SELECT
    COUNT_BIG(*) AS active_requests,
    SUM(CASE WHEN r.blocking_session_id <> 0 THEN 1 ELSE 0 END) AS blocked_requests,
    SUM(CONVERT(bigint, r.cpu_time)) AS total_cpu_ms,
    SUM(CONVERT(bigint, r.logical_reads)) AS total_logical_reads,
    MAX(CONVERT(bigint, r.total_elapsed_time)) AS longest_elapsed_ms,
    SYSUTCDATETIME() AS observed_at
FROM sys.dm_exec_requests AS r
JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
WHERE r.session_id <> @@SPID AND s.is_user_process = 1`,
};

export const blockingChain: CatalogQuery = {
    id: "dmv.blockingChain",
    title: "Blocking chain",
    description: "Every blocked request traced back to the session at the head of the chain.",
    platforms: [...EXEC_DMV_PLATFORMS],
    requiresCapability: "hasExecutionDmvs",
    requiresPermission: "VIEW SERVER STATE",
    permissionFor: executionPermission,
    columns: [
        { field: "level", header: "Depth", format: "number", width: 70 },
        { field: "session_id", header: "Session", format: "number", width: 80 },
        { field: "blocking_session_id", header: "Blocked by", format: "number", width: 100 },
        { field: "relationship", header: "Relationship", width: 150 },
        { field: "chain_status", header: "Chain status", width: 150 },
        { field: "wait_type", header: "Wait type", width: 140 },
        { field: "wait_time_ms", header: "Wait", format: "duration-ms", width: 90 },
        { field: "database_name", header: "Database", width: 130 },
        { field: "login_name", header: "Login", width: 120 },
        { field: "sql_text", header: "Statement", wide: true },
    ],
    sql: () => `
WITH edges AS (
    SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time,
           r.database_id, r.sql_handle, r.statement_start_offset, r.statement_end_offset,
           CASE
               WHEN r.blocking_session_id < 0 THEN 'special blocker'
               WHEN EXISTS (SELECT 1 FROM sys.dm_exec_requests AS p
                            WHERE p.session_id = r.blocking_session_id) THEN 'intermediate blocker'
               ELSE 'head or invisible blocker'
           END AS relationship,
           CASE
               WHEN r.blocking_session_id < 0 THEN 'special identifier'
               WHEN EXISTS (SELECT 1 FROM sys.dm_exec_sessions AS p
                            WHERE p.session_id = r.blocking_session_id) THEN 'visible'
               ELSE 'not visible in current request/session snapshot'
           END AS chain_status
    FROM sys.dm_exec_requests AS r
    WHERE r.blocking_session_id <> 0
),
walk AS (
    SELECT e.session_id AS root_session_id, e.session_id, e.blocking_session_id,
           e.wait_type, e.wait_time, e.database_id, e.sql_handle,
           e.statement_start_offset, e.statement_end_offset, e.relationship, e.chain_status,
           1 AS level,
           CONVERT(varchar(max), '/' + CONVERT(varchar(12), e.session_id) + '/') AS path,
           CONVERT(bit, 0) AS cycle_detected
    FROM edges AS e
    UNION ALL
    SELECT w.root_session_id, w.blocking_session_id AS session_id,
           parent.blocking_session_id, parent.wait_type, parent.wait_time, parent.database_id,
           parent.sql_handle, parent.statement_start_offset, parent.statement_end_offset,
           parent.relationship, parent.chain_status, w.level + 1,
           CONVERT(varchar(max), w.path + CONVERT(varchar(12), w.blocking_session_id) + '/'),
           CONVERT(bit, CASE WHEN CHARINDEX('/' + CONVERT(varchar(12), parent.blocking_session_id) + '/', w.path) > 0 THEN 1 ELSE 0 END)
    FROM walk AS w
    JOIN edges AS parent ON parent.session_id = w.blocking_session_id
    WHERE w.level < 32
      AND w.blocking_session_id >= 0
      AND CHARINDEX('/' + CONVERT(varchar(12), w.blocking_session_id) + '/', w.path) = 0
)
SELECT w.level, w.session_id, w.blocking_session_id, w.relationship,
       CASE WHEN w.cycle_detected = 1 THEN 'cycle detected' ELSE w.chain_status END AS chain_status,
       w.wait_type, w.wait_time AS wait_time_ms, DB_NAME(w.database_id) AS database_name,
       s.login_name,
       SUBSTRING(t.text,
           (w.statement_start_offset / 2) + 1,
           ((CASE w.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE w.statement_end_offset END
             - w.statement_start_offset) / 2) + 1) AS sql_text
FROM walk AS w
LEFT JOIN sys.dm_exec_sessions AS s ON s.session_id = w.session_id
OUTER APPLY sys.dm_exec_sql_text(w.sql_handle) AS t
ORDER BY w.root_session_id, w.level, w.session_id
OPTION (MAXRECURSION 32)`,
};

export const topQueriesByDuration: CatalogQuery = {
    id: "dmv.topQueriesByDuration",
    title: "Top queries by total duration",
    description:
        "The heaviest statements in the plan cache, ranked by total elapsed time since they were cached.",
    platforms: [...EXEC_DMV_PLATFORMS],
    requiresCapability: "hasExecutionDmvs",
    requiresPermission: "VIEW SERVER STATE",
    permissionFor: executionPermission,
    columns: [
        { field: "executions", header: "Executions", format: "number", width: 100 },
        { field: "total_elapsed_us", header: "Total duration", format: "duration-us", width: 130 },
        { field: "avg_elapsed_us", header: "Avg duration", format: "duration-us", width: 120 },
        { field: "total_worker_us", header: "Total CPU", format: "duration-us", width: 120 },
        { field: "total_logical_reads", header: "Reads", format: "number", width: 110 },
        { field: "last_execution_time", header: "Last run", format: "datetime", width: 160 },
        { field: "query_hash", header: "Query hash", width: 150 },
        { field: "sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => `
SELECT TOP (${topN(params, 50)})
    qs.execution_count                              AS executions,
    qs.total_elapsed_time                           AS total_elapsed_us,
    1.0 * qs.total_elapsed_time / NULLIF(qs.execution_count, 0) AS avg_elapsed_us,
    qs.total_worker_time                            AS total_worker_us,
    qs.total_logical_reads,
    qs.last_execution_time,
    CONVERT(varchar(34), qs.query_hash, 1)          AS query_hash,
    SUBSTRING(t.text,
        (qs.statement_start_offset / 2) + 1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE qs.statement_end_offset END
          - qs.statement_start_offset) / 2) + 1)    AS sql_text
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS t
ORDER BY qs.total_elapsed_time DESC`,
};

export const topQueriesByCpu: CatalogQuery = {
    ...topQueriesByDuration,
    id: "dmv.topQueriesByCpu",
    title: "Top queries by CPU",
    description: "The statements consuming the most processor time since they were cached.",
    sql: (params) =>
        topQueriesByDuration
            .sql(params)
            .replace("ORDER BY qs.total_elapsed_time DESC", "ORDER BY qs.total_worker_time DESC"),
};

export const topQueriesByReads: CatalogQuery = {
    ...topQueriesByDuration,
    id: "dmv.topQueriesByReads",
    title: "Top queries by reads",
    description: "The statements doing the most logical reads since they were cached.",
    sql: (params) =>
        topQueriesByDuration
            .sql(params)
            .replace("ORDER BY qs.total_elapsed_time DESC", "ORDER BY qs.total_logical_reads DESC"),
};

function workloadMetric(
    params: Readonly<Record<string, unknown>> | undefined,
): "total_elapsed_time" | "total_worker_time" | "total_logical_reads" {
    switch (params?.metric) {
        case "cpu":
            return "total_worker_time";
        case "reads":
            return "total_logical_reads";
        default:
            return "total_elapsed_time";
    }
}

export const topWorkload: CatalogQuery = {
    id: "dmv.topWorkload",
    title: "Query workload",
    description: "Rank one bounded workload sample by total duration, CPU, or logical reads.",
    platforms: [...EXEC_DMV_PLATFORMS],
    requiresCapability: "hasExecutionDmvs",
    requiresPermission: "VIEW SERVER STATE",
    permissionFor: executionPermission,
    columns: [
        { field: "executions", header: "Executions", format: "number", width: 100 },
        { field: "total_elapsed_us", header: "Total duration", format: "duration-us", width: 130 },
        { field: "total_cpu_us", header: "Total CPU", format: "duration-us", width: 120 },
        { field: "total_logical_reads", header: "Reads", format: "number", width: 110 },
        { field: "avg_elapsed_us", header: "Avg duration", format: "duration-us", width: 120 },
        { field: "avg_cpu_us", header: "Avg CPU", format: "duration-us", width: 110 },
        { field: "avg_logical_reads", header: "Avg reads", format: "number", width: 110 },
        { field: "last_execution_time", header: "Last run", format: "datetime", width: 160 },
        { field: "query_hash", header: "Query hash", width: 150 },
        { field: "sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => `
SELECT TOP (${topN(params, 50)})
    qs.execution_count AS executions,
    qs.total_elapsed_time AS total_elapsed_us,
    qs.total_worker_time AS total_cpu_us,
    qs.total_logical_reads,
    1.0 * qs.total_elapsed_time / NULLIF(qs.execution_count, 0) AS avg_elapsed_us,
    1.0 * qs.total_worker_time / NULLIF(qs.execution_count, 0) AS avg_cpu_us,
    1.0 * qs.total_logical_reads / NULLIF(qs.execution_count, 0) AS avg_logical_reads,
    qs.last_execution_time,
    CONVERT(varchar(34), qs.query_hash, 1) AS query_hash,
    SUBSTRING(t.text,
        (qs.statement_start_offset / 2) + 1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE qs.statement_end_offset END
          - qs.statement_start_offset) / 2) + 1) AS sql_text
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS t
ORDER BY qs.${workloadMetric(params)} DESC`,
};

export const waitStats: CatalogQuery = {
    id: "dmv.waitStats",
    title: "Wait statistics",
    description:
        "Cumulative server waits since startup or the last reset. The default background filter can be disabled.",
    platforms: [...SERVER_SCOPED],
    requiresCapability: "hasServerScopedDmvs",
    requiresPermission: "VIEW SERVER STATE",
    columns: [
        { field: "wait_type", header: "Wait type", width: 220 },
        { field: "wait_time_ms", header: "Total wait", format: "duration-ms", width: 120 },
        { field: "waiting_tasks_count", header: "Waits", format: "number", width: 110 },
        { field: "avg_wait_ms", header: "Avg wait", format: "duration-ms", width: 110 },
        { field: "signal_wait_time_ms", header: "Signal wait", format: "duration-ms", width: 120 },
        {
            field: "resource_wait_time_ms",
            header: "Resource wait",
            format: "duration-ms",
            width: 120,
        },
        { field: "pct_of_total", header: "Share", format: "percent", width: 90 },
    ],
    sql: (params) => `
WITH waits AS (
    SELECT wait_type, wait_time_ms, waiting_tasks_count, signal_wait_time_ms,
           100.0 * wait_time_ms / NULLIF(SUM(wait_time_ms) OVER (), 0) AS pct_of_total
    FROM sys.dm_os_wait_stats
    WHERE ${params?.showBackground === true ? "1 = 1" : `wait_type NOT IN (${BENIGN_WAITS})`} AND wait_time_ms > 0
)
SELECT TOP (1000)
    wait_type, wait_time_ms, waiting_tasks_count,
    1.0 * wait_time_ms / NULLIF(waiting_tasks_count, 0) AS avg_wait_ms,
    signal_wait_time_ms,
    CASE WHEN wait_time_ms >= signal_wait_time_ms THEN wait_time_ms - signal_wait_time_ms END AS resource_wait_time_ms,
    CAST(pct_of_total AS decimal(5, 2)) AS pct_of_total
FROM waits
ORDER BY wait_time_ms DESC`,
};

export const missingIndexes: CatalogQuery = {
    id: "dmv.missingIndexes",
    title: "Missing index suggestions",
    description:
        "Indexes the optimizer would have used. Treat as candidates to evaluate, not changes to apply as-is.",
    platforms: [...EXEC_DMV_PLATFORMS],
    requiresCapability: "hasExecutionDmvs",
    requiresPermission: "VIEW SERVER STATE",
    permissionFor: executionPermission,
    columns: [
        { field: "improvement_measure", header: "Impact", format: "number", width: 110 },
        { field: "database_name", header: "Database", width: 130 },
        { field: "table_name", header: "Table", width: 200 },
        { field: "equality_columns", header: "Equality columns", wide: true },
        { field: "inequality_columns", header: "Inequality columns", wide: true },
        { field: "included_columns", header: "Included columns", wide: true },
        { field: "user_seeks", header: "Seeks", format: "number", width: 90 },
        { field: "user_scans", header: "Scans", format: "number", width: 90 },
        { field: "avg_user_impact", header: "Avg impact", format: "percent", width: 110 },
        { field: "last_user_seek", header: "Last seek", format: "datetime", width: 160 },
        { field: "last_user_scan", header: "Last scan", format: "datetime", width: 160 },
        { field: "evidence_note", header: "Evidence note", wide: true },
    ],
    sql: (params) => `
SELECT TOP (${topN(params, 40)})
    CONVERT(decimal(18, 2), migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) / 100.0)
        AS improvement_measure,
    DB_NAME(mid.database_id) AS database_name,
    mid.statement            AS table_name,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    migs.user_seeks,
    migs.user_scans,
    CONVERT(decimal(5, 2), migs.avg_user_impact) AS avg_user_impact,
    migs.last_user_seek,
    migs.last_user_scan,
    'Candidate from counters since the last reset; validate workload, overlap, write cost and existing indexes before applying.' AS evidence_note
FROM sys.dm_db_missing_index_groups AS mig
JOIN sys.dm_db_missing_index_group_stats AS migs ON migs.group_handle = mig.index_group_handle
JOIN sys.dm_db_missing_index_details AS mid ON mig.index_handle = mid.index_handle
ORDER BY improvement_measure DESC`,
};

export const fileIoStalls: CatalogQuery = {
    id: "dmv.fileIoStalls",
    title: "File I/O stalls",
    description:
        "Read and write latency per database file, to find storage that is holding the server back.",
    platforms: [...SERVER_SCOPED],
    requiresCapability: "hasServerScopedDmvs",
    requiresPermission: "VIEW SERVER STATE",
    columns: [
        { field: "database_name", header: "Database", width: 150 },
        { field: "file_name", header: "File", width: 150 },
        { field: "type_desc", header: "Type", width: 90 },
        { field: "avg_read_stall_ms", header: "Avg read", format: "duration-ms", width: 110 },
        { field: "avg_write_stall_ms", header: "Avg write", format: "duration-ms", width: 110 },
        { field: "read_latency_status", header: "Read measurement", width: 130 },
        { field: "write_latency_status", header: "Write measurement", width: 130 },
        { field: "num_of_reads", header: "Reads", format: "number", width: 110 },
        { field: "num_of_writes", header: "Writes", format: "number", width: 110 },
        { field: "size_bytes", header: "Size", format: "bytes", width: 110 },
    ],
    sql: () => `
SELECT
    DB_NAME(vfs.database_id)                                        AS database_name,
    mf.name                                                         AS file_name,
    mf.type_desc,
    vfs.io_stall_read_ms,
    vfs.io_stall_write_ms,
    1.0 * vfs.io_stall_read_ms / NULLIF(vfs.num_of_reads, 0)         AS avg_read_stall_ms,
    1.0 * vfs.io_stall_write_ms / NULLIF(vfs.num_of_writes, 0)       AS avg_write_stall_ms,
    CASE WHEN vfs.num_of_reads = 0 THEN 'not measured' ELSE 'measured' END AS read_latency_status,
    CASE WHEN vfs.num_of_writes = 0 THEN 'not measured' ELSE 'measured' END AS write_latency_status,
    vfs.num_of_reads,
    vfs.num_of_writes,
    vfs.size_on_disk_bytes                                          AS size_bytes
FROM sys.dm_io_virtual_file_stats(NULL, NULL) AS vfs
JOIN sys.master_files AS mf
  ON mf.database_id = vfs.database_id AND mf.file_id = vfs.file_id
ORDER BY (vfs.io_stall_read_ms + vfs.io_stall_write_ms) DESC`,
};

/**
 * Azure SQL Database has no sys.dm_os_wait_stats; the database-scoped equivalent carries the
 * same columns for the waits a single database can see.
 */
export const waitStatsAzure: CatalogQuery = {
    ...waitStats,
    id: "dmv.waitStatsAzure",
    title: "Wait statistics (database)",
    description: "Cumulative database waits. The default background filter can be disabled.",
    platforms: ["azureSqlDatabase", "fabric"],
    requiresCapability: undefined,
    requiresPermission: "VIEW DATABASE STATE",
    sql: (params) => waitStats.sql(params).replace("sys.dm_os_wait_stats", "sys.dm_db_wait_stats"),
};

export const dmvQueries: readonly CatalogQuery[] = [
    overview,
    activeRequests,
    blockingChain,
    topQueriesByDuration,
    topQueriesByCpu,
    topQueriesByReads,
    topWorkload,
    waitStats,
    waitStatsAzure,
    missingIndexes,
    fileIoStalls,
];
