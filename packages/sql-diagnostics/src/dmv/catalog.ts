/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CatalogQuery } from "../core/catalog";

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

/**
 * Waits that are almost always background noise. Every wait-stats script in the field filters
 * these out; leaving them in buries the wait that actually matters under sleep timers.
 */
const BENIGN_WAITS = [
    "BROKER_EVENTHANDLER",
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

export const blockingChain: CatalogQuery = {
    id: "dmv.blockingChain",
    title: "Blocking chain",
    description: "Every blocked request traced back to the session at the head of the chain.",
    platforms: [...EXEC_DMV_PLATFORMS],
    requiresCapability: "hasExecutionDmvs",
    requiresPermission: "VIEW SERVER STATE",
    columns: [
        { field: "level", header: "Depth", format: "number", width: 70 },
        { field: "session_id", header: "Session", format: "number", width: 80 },
        { field: "blocking_session_id", header: "Blocked by", format: "number", width: 100 },
        { field: "head_blocker", header: "Head blocker", format: "number", width: 110 },
        { field: "wait_type", header: "Wait type", width: 140 },
        { field: "wait_time_ms", header: "Wait", format: "duration-ms", width: 90 },
        { field: "login_name", header: "Login", width: 120 },
        { field: "sql_text", header: "Statement", wide: true },
    ],
    sql: () => `
WITH blocked AS (
    SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time, r.sql_handle,
           r.statement_start_offset, r.statement_end_offset
    FROM sys.dm_exec_requests AS r
    WHERE r.blocking_session_id <> 0
),
chain AS (
    SELECT b.session_id, b.blocking_session_id, b.wait_type, b.wait_time,
           b.sql_handle, b.statement_start_offset, b.statement_end_offset,
           1 AS level, b.blocking_session_id AS head_blocker
    FROM blocked AS b
    WHERE NOT EXISTS (SELECT 1 FROM blocked AS p WHERE p.session_id = b.blocking_session_id)
    UNION ALL
    SELECT b.session_id, b.blocking_session_id, b.wait_type, b.wait_time,
           b.sql_handle, b.statement_start_offset, b.statement_end_offset,
           c.level + 1, c.head_blocker
    FROM blocked AS b
    JOIN chain AS c ON b.blocking_session_id = c.session_id
    WHERE c.level < 32
)
SELECT c.level, c.session_id, c.blocking_session_id, c.head_blocker,
       c.wait_type, c.wait_time AS wait_time_ms, s.login_name,
       SUBSTRING(t.text,
           (c.statement_start_offset / 2) + 1,
           ((CASE c.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE c.statement_end_offset END
             - c.statement_start_offset) / 2) + 1) AS sql_text
FROM chain AS c
LEFT JOIN sys.dm_exec_sessions AS s ON s.session_id = c.session_id
OUTER APPLY sys.dm_exec_sql_text(c.sql_handle) AS t
ORDER BY c.head_blocker, c.level, c.session_id
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
    qs.total_elapsed_time / qs.execution_count      AS avg_elapsed_us,
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

export const waitStats: CatalogQuery = {
    id: "dmv.waitStats",
    title: "Wait statistics",
    description:
        "What the server has spent time waiting on since startup, with background waits filtered out.",
    platforms: [...SERVER_SCOPED],
    requiresCapability: "hasServerScopedDmvs",
    requiresPermission: "VIEW SERVER STATE",
    columns: [
        { field: "wait_type", header: "Wait type", width: 220 },
        { field: "wait_time_ms", header: "Total wait", format: "duration-ms", width: 120 },
        { field: "waiting_tasks_count", header: "Waits", format: "number", width: 110 },
        { field: "avg_wait_ms", header: "Avg wait", format: "duration-ms", width: 110 },
        { field: "signal_wait_time_ms", header: "Signal wait", format: "duration-ms", width: 120 },
        { field: "pct_of_total", header: "Share", format: "percent", width: 90 },
    ],
    sql: (params) => `
WITH waits AS (
    SELECT wait_type, wait_time_ms, waiting_tasks_count, signal_wait_time_ms,
           100.0 * wait_time_ms / NULLIF(SUM(wait_time_ms) OVER (), 0) AS pct_of_total
    FROM sys.dm_os_wait_stats
    WHERE wait_type NOT IN (${BENIGN_WAITS}) AND wait_time_ms > 0
)
SELECT TOP (${topN(params, 30)})
    wait_type, wait_time_ms, waiting_tasks_count,
    wait_time_ms / NULLIF(waiting_tasks_count, 0) AS avg_wait_ms,
    signal_wait_time_ms,
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
    columns: [
        { field: "improvement_measure", header: "Impact", format: "number", width: 110 },
        { field: "database_name", header: "Database", width: 130 },
        { field: "table_name", header: "Table", width: 200 },
        { field: "equality_columns", header: "Equality columns", wide: true },
        { field: "inequality_columns", header: "Inequality columns", wide: true },
        { field: "included_columns", header: "Included columns", wide: true },
        { field: "user_seeks", header: "Seeks", format: "number", width: 90 },
        { field: "avg_user_impact", header: "Avg impact", format: "percent", width: 110 },
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
    CONVERT(decimal(5, 2), migs.avg_user_impact) AS avg_user_impact
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
        { field: "num_of_reads", header: "Reads", format: "number", width: 110 },
        { field: "num_of_writes", header: "Writes", format: "number", width: 110 },
        { field: "size_bytes", header: "Size", format: "bytes", width: 110 },
    ],
    sql: () => `
SELECT
    DB_NAME(vfs.database_id)                                        AS database_name,
    mf.name                                                         AS file_name,
    mf.type_desc,
    vfs.io_stall_read_ms / NULLIF(vfs.num_of_reads, 0)              AS avg_read_stall_ms,
    vfs.io_stall_write_ms / NULLIF(vfs.num_of_writes, 0)            AS avg_write_stall_ms,
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
    description: "What this database has waited on, with background waits filtered out.",
    platforms: ["azureSqlDatabase", "fabric"],
    requiresCapability: undefined,
    requiresPermission: "VIEW DATABASE STATE",
    sql: (params) => waitStats.sql(params).replace("sys.dm_os_wait_stats", "sys.dm_db_wait_stats"),
};

export const dmvQueries: readonly CatalogQuery[] = [
    activeRequests,
    blockingChain,
    topQueriesByDuration,
    topQueriesByCpu,
    topQueriesByReads,
    waitStats,
    waitStatsAzure,
    missingIndexes,
    fileIoStalls,
];
