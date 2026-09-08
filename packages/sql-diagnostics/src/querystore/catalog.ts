/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CatalogQuery } from "../core/catalog";

const QDS_PLATFORMS = ["sqlServer", "managedInstance", "azureSqlDatabase", "fabric"] as const;

/** SQL that reports whether Query Store is collecting for the current database. */
export const queryStoreStateSql = `
SELECT
    CONVERT(bit, CASE WHEN actual_state = 0 THEN 0 ELSE 1 END) AS is_on,
    actual_state_desc  AS state,
    readonly_reason
FROM sys.database_query_store_options`;

/**
 * Turns Query Store on or off for a database.
 *
 * ALTER DATABASE takes no parameters, so the database name has to be an identifier in the text.
 * It is quoted rather than interpolated: a name carrying a bracket cannot close the identifier
 * and append a statement of its own.
 *
 * Turning it on uses READ_WRITE, since READ_ONLY collects nothing and would leave the user
 * looking at an empty Query Store wondering why.
 */
export function setQueryStoreSql(database: string, enabled: boolean): string {
    if (!database.trim()) {
        throw new Error("A database name is required.");
    }
    const name = `[${database.replace(/]/g, "]]")}]`;
    return enabled
        ? `ALTER DATABASE ${name} SET QUERY_STORE = ON (OPERATION_MODE = READ_WRITE)`
        : `ALTER DATABASE ${name} SET QUERY_STORE = OFF`;
}

/** Clamps a caller-supplied row limit. */
function topN(params: Readonly<Record<string, unknown>> | undefined, fallback: number): number {
    const raw = params?.top;
    const n = typeof raw === "number" ? Math.floor(raw) : Number.NaN;
    return Number.isFinite(n) && n > 0 && n <= 1000 ? n : fallback;
}

/** Clamps a lookback window in hours. */
function hours(
    params: Readonly<Record<string, unknown>> | undefined,
    key: string,
    fallback: number,
): number {
    const raw = params?.[key];
    const n = typeof raw === "number" ? Math.floor(raw) : Number.NaN;
    return Number.isFinite(n) && n > 0 && n <= 24 * 90 ? n : fallback;
}

export const topResourceConsumers: CatalogQuery = {
    id: "qds.topResourceConsumers",
    title: "Top resource consumers",
    description:
        "The heaviest queries over a window, from Query Store rather than the volatile plan cache.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "plan_id", header: "Plan", format: "number", width: 80 },
        { field: "executions", header: "Executions", format: "number", width: 100 },
        { field: "total_duration_us", header: "Total duration", format: "duration-us", width: 130 },
        { field: "avg_duration_us", header: "Avg duration", format: "duration-us", width: 120 },
        { field: "avg_cpu_us", header: "Avg CPU", format: "duration-us", width: 110 },
        { field: "avg_logical_reads", header: "Avg reads", format: "number", width: 110 },
        { field: "last_execution_time", header: "Last run", format: "datetime", width: 160 },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => `
SELECT TOP (${topN(params, 50)})
    q.query_id,
    p.plan_id,
    SUM(rs.count_executions)                                        AS executions,
    SUM(rs.avg_duration * rs.count_executions)                      AS total_duration_us,
    CONVERT(bigint, AVG(rs.avg_duration))                           AS avg_duration_us,
    CONVERT(bigint, AVG(rs.avg_cpu_time))                           AS avg_cpu_us,
    CONVERT(bigint, AVG(rs.avg_logical_io_reads))                   AS avg_logical_reads,
    MAX(rs.last_execution_time)                                     AS last_execution_time,
    MIN(qt.query_sql_text)                                          AS query_sql_text
FROM sys.query_store_runtime_stats AS rs
JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
JOIN sys.query_store_plan  AS p  ON p.plan_id  = rs.plan_id
JOIN sys.query_store_query AS q  ON q.query_id = p.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE rsi.start_time >= DATEADD(hour, -${hours(params, "hours", 24)}, SYSUTCDATETIME())
GROUP BY q.query_id, p.plan_id
ORDER BY total_duration_us DESC`,
};

export const regressedQueries: CatalogQuery = {
    id: "qds.regressedQueries",
    title: "Regressed queries",
    description:
        "Queries that got slower between two windows. This is the question Query Store exists to answer: what changed?",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "recent_avg_us", header: "Recent avg", format: "duration-us", width: 120 },
        { field: "baseline_avg_us", header: "Baseline avg", format: "duration-us", width: 120 },
        { field: "regression_factor", header: "Times slower", format: "number", width: 120 },
        { field: "recent_executions", header: "Recent runs", format: "number", width: 110 },
        { field: "baseline_executions", header: "Baseline runs", format: "number", width: 120 },
        { field: "recent_plan_id", header: "Recent plan", format: "number", width: 110 },
        { field: "baseline_plan_id", header: "Baseline plan", format: "number", width: 120 },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => {
        const recent = hours(params, "recentHours", 1);
        const baseline = hours(params, "baselineHours", 24);
        const minExecutions = topN(params, 5);
        return `
WITH recent AS (
    SELECT p.query_id,
           SUM(rs.count_executions)                    AS executions,
           SUM(rs.avg_duration * rs.count_executions)
             / NULLIF(SUM(rs.count_executions), 0)     AS avg_duration_us,
           MAX(rs.plan_id)                             AS plan_id
    FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
    WHERE rsi.start_time >= DATEADD(hour, -${recent}, SYSUTCDATETIME())
    GROUP BY p.query_id
),
baseline AS (
    SELECT p.query_id,
           SUM(rs.count_executions)                    AS executions,
           SUM(rs.avg_duration * rs.count_executions)
             / NULLIF(SUM(rs.count_executions), 0)     AS avg_duration_us,
           MAX(rs.plan_id)                             AS plan_id
    FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
    WHERE rsi.start_time >= DATEADD(hour, -${baseline}, SYSUTCDATETIME())
      AND rsi.start_time <  DATEADD(hour, -${recent}, SYSUTCDATETIME())
    GROUP BY p.query_id
)
SELECT TOP (50)
    r.query_id,
    CONVERT(bigint, r.avg_duration_us)                          AS recent_avg_us,
    CONVERT(bigint, b.avg_duration_us)                          AS baseline_avg_us,
    CONVERT(decimal(10, 2), r.avg_duration_us / NULLIF(b.avg_duration_us, 0)) AS regression_factor,
    r.executions                                                AS recent_executions,
    b.executions                                                AS baseline_executions,
    r.plan_id                                                   AS recent_plan_id,
    b.plan_id                                                   AS baseline_plan_id,
    qt.query_sql_text
FROM recent AS r
JOIN baseline AS b ON b.query_id = r.query_id
JOIN sys.query_store_query AS q ON q.query_id = r.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE r.executions >= ${minExecutions}
  AND b.executions >= ${minExecutions}
  AND r.avg_duration_us > b.avg_duration_us * 1.5
ORDER BY regression_factor DESC`;
    },
};

export const highVariationQueries: CatalogQuery = {
    id: "qds.highVariation",
    title: "High variation queries",
    description:
        "Queries whose duration swings the most run to run, which often means parameter-sensitive plans.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "executions", header: "Executions", format: "number", width: 100 },
        { field: "avg_duration_us", header: "Avg duration", format: "duration-us", width: 120 },
        { field: "stdev_duration_us", header: "Std deviation", format: "duration-us", width: 130 },
        { field: "variation_coefficient", header: "Variation", format: "number", width: 100 },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => `
SELECT TOP (${topN(params, 50)})
    q.query_id,
    SUM(rs.count_executions)                                     AS executions,
    CONVERT(bigint, AVG(rs.avg_duration))                        AS avg_duration_us,
    CONVERT(bigint, AVG(rs.stdev_duration))                      AS stdev_duration_us,
    CONVERT(decimal(10, 2), AVG(rs.stdev_duration) / NULLIF(AVG(rs.avg_duration), 0)) AS variation_coefficient,
    MIN(qt.query_sql_text)                                       AS query_sql_text
FROM sys.query_store_runtime_stats AS rs
JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
JOIN sys.query_store_plan  AS p  ON p.plan_id  = rs.plan_id
JOIN sys.query_store_query AS q  ON q.query_id = p.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE rsi.start_time >= DATEADD(hour, -${hours(params, "hours", 24)}, SYSUTCDATETIME())
GROUP BY q.query_id
HAVING SUM(rs.count_executions) >= 5 AND AVG(rs.avg_duration) > 0
ORDER BY variation_coefficient DESC`,
};

export const forcedPlans: CatalogQuery = {
    id: "qds.forcedPlans",
    title: "Forced plans",
    description: "Plans pinned by an administrator, including any that are failing to be applied.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "plan_id", header: "Plan", format: "number", width: 80 },
        { field: "force_failure_count", header: "Force failures", format: "number", width: 120 },
        { field: "last_force_failure_reason_desc", header: "Failure reason", width: 200 },
        { field: "last_execution_time", header: "Last run", format: "datetime", width: 160 },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: () => `
SELECT
    q.query_id, p.plan_id, p.force_failure_count, p.last_force_failure_reason_desc,
    p.last_execution_time, qt.query_sql_text
FROM sys.query_store_plan AS p
JOIN sys.query_store_query AS q ON q.query_id = p.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE p.is_forced_plan = 1
ORDER BY p.force_failure_count DESC, p.last_execution_time DESC`,
};

/** Fetches the showplan XML for one Query Store plan. Large, so it raises the cell bound. */
export const planForQueryStorePlan: CatalogQuery = {
    id: "qds.planXml",
    title: "Execution plan (Query Store)",
    description: "The stored showplan XML for a specific plan id.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    // Showplan XML for a complex query reaches megabytes; the default text bound clips it into
    // invalid XML, and the plan viewer would fail with nothing useful to say.
    maxCellBytes: 16 * 1024 * 1024,
    columns: [
        { field: "plan_id", header: "Plan", format: "number", width: 80 },
        { field: "query_plan", header: "Showplan XML", wide: true },
    ],
    sql: (params) => {
        const planId = Number(params?.planId);
        if (!Number.isFinite(planId) || planId <= 0) {
            throw new Error("planId is required and must be a positive number.");
        }
        return `SELECT plan_id, query_plan FROM sys.query_store_plan WHERE plan_id = ${Math.floor(planId)}`;
    },
};

export const queryStoreQueries: readonly CatalogQuery[] = [
    topResourceConsumers,
    regressedQueries,
    highVariationQueries,
    forcedPlans,
];
