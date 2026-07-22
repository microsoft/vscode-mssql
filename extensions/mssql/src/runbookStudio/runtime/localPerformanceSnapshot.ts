/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Closed SQL Server performance snapshot used by the local Runbook Studio
 * lane. The query returns counters and active-state facts only: query text,
 * plans, login names, host names, and application data are deliberately
 * excluded. A snapshot is factual point-in-time evidence, not a regression
 * verdict and not proof that cumulative server counters belong to one run.
 */

import * as crypto from "crypto";
import { canonicalRunbookJson } from "../runbookDigest";

export const MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS = 500;

export const LOCAL_PERFORMANCE_SNAPSHOT_SQL = `
WITH captured AS (
    SELECT CONVERT(varchar(33), SYSUTCDATETIME(), 126) + 'Z' AS captured_at_utc
),
database_io AS (
    SELECT
        CAST(N'database' AS nvarchar(32)) AS scope_name,
        CAST(N'database_io' AS nvarchar(64)) AS category,
        CONVERT(nvarchar(256), CONCAT(df.type_desc, N':', df.name)) AS item,
        CONVERT(nvarchar(128), metric.metric_name) AS metric,
        CONVERT(float, metric.metric_value) AS metric_value,
        CONVERT(nvarchar(32), metric.unit_name) AS unit
    FROM sys.dm_io_virtual_file_stats(DB_ID(), NULL) AS vfs
    INNER JOIN sys.database_files AS df ON df.file_id = vfs.file_id
    CROSS APPLY (VALUES
        (N'reads', CONVERT(bigint, vfs.num_of_reads), N'count'),
        (N'bytes_read', CONVERT(bigint, vfs.num_of_bytes_read), N'bytes'),
        (N'read_stall', CONVERT(bigint, vfs.io_stall_read_ms), N'ms'),
        (N'writes', CONVERT(bigint, vfs.num_of_writes), N'count'),
        (N'bytes_written', CONVERT(bigint, vfs.num_of_bytes_written), N'bytes'),
        (N'write_stall', CONVERT(bigint, vfs.io_stall_write_ms), N'ms'),
        (N'size_on_disk', CONVERT(bigint, vfs.size_on_disk_bytes), N'bytes')
    ) AS metric(metric_name, metric_value, unit_name)
),
database_space AS (
    SELECT
        CAST(N'database' AS nvarchar(32)) AS scope_name,
        CAST(N'database_space' AS nvarchar(64)) AS category,
        CONVERT(nvarchar(256), CONCAT(type_desc, N':', name)) AS item,
        CONVERT(nvarchar(128), metric.metric_name) AS metric,
        CONVERT(float, metric.metric_value) AS metric_value,
        CAST(N'pages' AS nvarchar(32)) AS unit
    FROM sys.database_files
    CROSS APPLY (VALUES
        (N'allocated', CONVERT(bigint, size)),
        (N'used', CONVERT(bigint, COALESCE(FILEPROPERTY(name, 'SpaceUsed'), 0)))
    ) AS metric(metric_name, metric_value)
),
top_waits AS (
    SELECT TOP (20) wait_type, waiting_tasks_count, wait_time_ms
    FROM sys.dm_os_wait_stats
    WHERE wait_type NOT LIKE N'SLEEP%'
      AND wait_type NOT LIKE N'BROKER%'
      AND wait_type NOT IN (
          N'CLR_AUTO_EVENT', N'CLR_MANUAL_EVENT', N'DIRTY_PAGE_POLL',
          N'DISPATCHER_QUEUE_SEMAPHORE', N'FT_IFTS_SCHEDULER_IDLE_WAIT',
          N'HADR_FILESTREAM_IOMGR_IOCOMPLETION', N'LAZYWRITER_SLEEP',
          N'LOGMGR_QUEUE', N'ONDEMAND_TASK_QUEUE', N'REQUEST_FOR_DEADLOCK_SEARCH',
          N'RESOURCE_QUEUE', N'SERVER_IDLE_CHECK', N'SP_SERVER_DIAGNOSTICS_SLEEP',
          N'SQLTRACE_BUFFER_FLUSH', N'XE_DISPATCHER_JOIN', N'XE_DISPATCHER_WAIT',
          N'XE_TIMER_EVENT'
      )
    ORDER BY wait_time_ms DESC, wait_type
),
server_waits AS (
    SELECT
        CAST(N'server' AS nvarchar(32)) AS scope_name,
        CAST(N'server_waits_cumulative' AS nvarchar(64)) AS category,
        CONVERT(nvarchar(256), wait_type) AS item,
        CONVERT(nvarchar(128), metric.metric_name) AS metric,
        CONVERT(float, metric.metric_value) AS metric_value,
        CONVERT(nvarchar(32), metric.unit_name) AS unit
    FROM top_waits
    CROSS APPLY (VALUES
        (N'wait_time', CONVERT(bigint, wait_time_ms), N'ms'),
        (N'waiting_tasks', CONVERT(bigint, waiting_tasks_count), N'count')
    ) AS metric(metric_name, metric_value, unit_name)
),
top_queries AS (
    SELECT TOP (20)
        qs.query_hash,
        qs.execution_count,
        qs.total_worker_time,
        qs.total_elapsed_time,
        qs.total_logical_reads,
        qs.total_logical_writes
    FROM sys.dm_exec_query_stats AS qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS statement_text
    WHERE statement_text.dbid = DB_ID()
    ORDER BY qs.total_worker_time DESC, qs.query_hash
),
query_counters AS (
    SELECT
        CAST(N'database' AS nvarchar(32)) AS scope_name,
        CAST(N'query_counters_cumulative' AS nvarchar(64)) AS category,
        CONVERT(nvarchar(256), CONVERT(varchar(34), query_hash, 1)) AS item,
        CONVERT(nvarchar(128), metric.metric_name) AS metric,
        CONVERT(float, metric.metric_value) AS metric_value,
        CONVERT(nvarchar(32), metric.unit_name) AS unit
    FROM top_queries
    CROSS APPLY (VALUES
        (N'executions', CONVERT(bigint, execution_count), N'count'),
        (N'worker_time', CONVERT(bigint, total_worker_time), N'microseconds'),
        (N'elapsed_time', CONVERT(bigint, total_elapsed_time), N'microseconds'),
        (N'logical_reads', CONVERT(bigint, total_logical_reads), N'pages'),
        (N'logical_writes', CONVERT(bigint, total_logical_writes), N'pages')
    ) AS metric(metric_name, metric_value, unit_name)
),
active_requests AS (
    SELECT TOP (20)
        session_id,
        blocking_session_id,
        cpu_time,
        total_elapsed_time,
        logical_reads,
        reads,
        writes
    FROM sys.dm_exec_requests
    WHERE database_id = DB_ID() AND session_id <> @@SPID
    ORDER BY total_elapsed_time DESC, session_id
),
request_counters AS (
    SELECT
        CAST(N'active' AS nvarchar(32)) AS scope_name,
        CAST(N'active_requests' AS nvarchar(64)) AS category,
        CONVERT(nvarchar(256), CONCAT(N'session:', session_id)) AS item,
        CONVERT(nvarchar(128), metric.metric_name) AS metric,
        CONVERT(float, metric.metric_value) AS metric_value,
        CONVERT(nvarchar(32), metric.unit_name) AS unit
    FROM active_requests
    CROSS APPLY (VALUES
        (N'blocking_session_id', CONVERT(bigint, blocking_session_id), N'session'),
        (N'cpu_time', CONVERT(bigint, cpu_time), N'ms'),
        (N'elapsed_time', CONVERT(bigint, total_elapsed_time), N'ms'),
        (N'logical_reads', CONVERT(bigint, logical_reads), N'pages'),
        (N'reads', CONVERT(bigint, reads), N'count'),
        (N'writes', CONVERT(bigint, writes), N'count')
    ) AS metric(metric_name, metric_value, unit_name)
),
server_context AS (
    SELECT
        CAST(N'server' AS nvarchar(32)) AS scope_name,
        CAST(N'server_context' AS nvarchar(64)) AS category,
        CAST(N'instance' AS nvarchar(256)) AS item,
        CAST(N'uptime' AS nvarchar(128)) AS metric,
        CONVERT(float, DATEDIFF_BIG(second, sqlserver_start_time, SYSUTCDATETIME())) AS metric_value,
        CAST(N'seconds' AS nvarchar(32)) AS unit
    FROM sys.dm_os_sys_info
),
metric_rows AS (
    SELECT
        scope_name COLLATE DATABASE_DEFAULT AS scope_name,
        category COLLATE DATABASE_DEFAULT AS category,
        item COLLATE DATABASE_DEFAULT AS item,
        metric COLLATE DATABASE_DEFAULT AS metric,
        metric_value,
        unit COLLATE DATABASE_DEFAULT AS unit
    FROM database_io
    UNION ALL SELECT
        scope_name COLLATE DATABASE_DEFAULT,
        category COLLATE DATABASE_DEFAULT,
        item COLLATE DATABASE_DEFAULT,
        metric COLLATE DATABASE_DEFAULT,
        metric_value,
        unit COLLATE DATABASE_DEFAULT
    FROM database_space
    UNION ALL SELECT
        scope_name COLLATE DATABASE_DEFAULT,
        category COLLATE DATABASE_DEFAULT,
        item COLLATE DATABASE_DEFAULT,
        metric COLLATE DATABASE_DEFAULT,
        metric_value,
        unit COLLATE DATABASE_DEFAULT
    FROM server_waits
    UNION ALL SELECT
        scope_name COLLATE DATABASE_DEFAULT,
        category COLLATE DATABASE_DEFAULT,
        item COLLATE DATABASE_DEFAULT,
        metric COLLATE DATABASE_DEFAULT,
        metric_value,
        unit COLLATE DATABASE_DEFAULT
    FROM query_counters
    UNION ALL SELECT
        scope_name COLLATE DATABASE_DEFAULT,
        category COLLATE DATABASE_DEFAULT,
        item COLLATE DATABASE_DEFAULT,
        metric COLLATE DATABASE_DEFAULT,
        metric_value,
        unit COLLATE DATABASE_DEFAULT
    FROM request_counters
    UNION ALL SELECT
        scope_name COLLATE DATABASE_DEFAULT,
        category COLLATE DATABASE_DEFAULT,
        item COLLATE DATABASE_DEFAULT,
        metric COLLATE DATABASE_DEFAULT,
        metric_value,
        unit COLLATE DATABASE_DEFAULT
    FROM server_context
)
SELECT TOP (${MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS})
    captured.captured_at_utc,
    metric_rows.scope_name,
    metric_rows.category,
    metric_rows.item,
    metric_rows.metric,
    metric_rows.metric_value,
    metric_rows.unit,
    COUNT_BIG(*) OVER () AS total_metric_count
FROM metric_rows
CROSS JOIN captured
ORDER BY metric_rows.category, metric_rows.item, metric_rows.metric;`.trim();

export interface LocalPerformanceSnapshotRow {
    capturedAtUtc: string;
    scope: "database" | "server" | "active";
    category: string;
    item: string;
    metric: string;
    value: number;
    unit: string;
}

export interface LocalPerformanceSnapshotResult {
    capturedAtUtc: string;
    rows: LocalPerformanceSnapshotRow[];
    totalMetricCount: number;
    truncated: boolean;
    snapshotSha256: string;
    categoryCounts: Record<string, number>;
}

export class LocalPerformanceSnapshotError extends Error {
    constructor(public readonly reason: "invalidShape" | "invalidValue" | "tooManyRows") {
        super(`Invalid local performance snapshot: ${reason}`);
        this.name = "LocalPerformanceSnapshotError";
    }
}

export function projectLocalPerformanceSnapshot(
    rawRows: readonly (readonly unknown[])[],
): LocalPerformanceSnapshotResult {
    if (rawRows.length === 0 || rawRows.length > MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS) {
        throw new LocalPerformanceSnapshotError(
            rawRows.length > MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS ? "tooManyRows" : "invalidShape",
        );
    }
    const rows = rawRows.map((raw): LocalPerformanceSnapshotRow => {
        if (raw.length !== 8) {
            throw new LocalPerformanceSnapshotError("invalidShape");
        }
        const capturedAtUtc = boundedString(raw[0], 40);
        const scope = boundedString(raw[1], 32);
        const category = boundedString(raw[2], 64);
        const item = boundedString(raw[3], 256);
        const metric = boundedString(raw[4], 128);
        const value = finiteNumber(raw[5]);
        const unit = boundedString(raw[6], 32);
        if (
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(capturedAtUtc) ||
            !["database", "server", "active"].includes(scope) ||
            !/^[a-z][a-z0-9_]*$/.test(category) ||
            !/^[a-z][a-z0-9_]*$/.test(metric) ||
            !/^[a-z][a-z0-9_]*$/.test(unit)
        ) {
            throw new LocalPerformanceSnapshotError("invalidValue");
        }
        return {
            capturedAtUtc,
            scope: scope as LocalPerformanceSnapshotRow["scope"],
            category,
            item,
            metric,
            value,
            unit,
        };
    });
    const capturedAtUtc = rows[0].capturedAtUtc;
    if (rows.some((row) => row.capturedAtUtc !== capturedAtUtc)) {
        throw new LocalPerformanceSnapshotError("invalidValue");
    }
    const totalMetricCount = integerMetric(rawRows[0][7]);
    if (totalMetricCount < rows.length) {
        throw new LocalPerformanceSnapshotError("invalidValue");
    }
    const categoryCounts: Record<string, number> = {};
    for (const row of rows) {
        categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
    }
    return {
        capturedAtUtc,
        rows,
        totalMetricCount,
        truncated: totalMetricCount > rows.length,
        snapshotSha256: crypto
            .createHash("sha256")
            .update(canonicalRunbookJson({ rows, totalMetricCount }))
            .digest("hex"),
        categoryCounts,
    };
}

function boundedString(value: unknown, maximumLength: number): string {
    if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
        throw new LocalPerformanceSnapshotError("invalidValue");
    }
    return value;
}

function finiteNumber(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new LocalPerformanceSnapshotError("invalidValue");
    }
    return numeric;
}

function integerMetric(value: unknown): number {
    const numeric = finiteNumber(value);
    if (!Number.isSafeInteger(numeric)) {
        throw new LocalPerformanceSnapshotError("invalidValue");
    }
    return numeric;
}
