/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CatalogQuery } from "../../core/catalog";
import {
    normalizeInstant,
    queryStoreReferenceSql,
    type QueryStoreAggregation,
    type QueryStoreExecutionType,
    type QueryStoreMetric,
} from "./context";

const QDS_PLATFORMS = ["sqlServer", "managedInstance", "azureSqlDatabase", "fabric"] as const;

/** SQL that reports whether Query Store is collecting for the current database. */
export const queryStoreStateSql = `
SELECT options.*,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DATABASE STATE') AS can_read_history,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS can_configure
FROM sys.database_query_store_options AS options`;

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

function metric(params: Readonly<Record<string, unknown>> | undefined): QueryStoreMetric {
    return params?.metric === "cpu" || params?.metric === "reads" || params?.metric === "executions"
        ? params.metric
        : "duration";
}

function aggregation(params: Readonly<Record<string, unknown>> | undefined): QueryStoreAggregation {
    return params?.aggregation === "total" ||
        params?.aggregation === "maximum" ||
        params?.aggregation === "pooledVariation"
        ? params.aggregation
        : "weightedMean";
}

function executionTypes(params: Readonly<Record<string, unknown>> | undefined): string {
    switch (params?.executionType as QueryStoreExecutionType | undefined) {
        case "all":
            return "IN (0, 1, 2)";
        case "aborted":
            return "= 1";
        case "exception":
            return "= 2";
        default:
            return "= 0";
    }
}

function textLiteral(value: string): string {
    return `N'${value.replace(/'/g, "''")}'`;
}

function queryTextFilter(
    params: Readonly<Record<string, unknown>> | undefined,
    alias = "qt",
): string {
    if (typeof params?.text !== "string" || params.text.trim().length === 0) return "";
    const escaped = params.text.trim().replace(/[\\%_\[]/g, (character) => `\\${character}`);
    return ` AND ${alias}.query_sql_text LIKE ${textLiteral(`%${escaped}%`)} ESCAPE N'\\'`;
}

function queryIdFilter(params: Readonly<Record<string, unknown>> | undefined, alias = "q"): string {
    const queryId = params?.queryId;
    return typeof queryId === "number" && Number.isSafeInteger(queryId) && queryId > 0
        ? ` AND ${alias}.query_id = ${queryId}`
        : "";
}

function sourceFilter(params: Readonly<Record<string, unknown>> | undefined, alias = "q"): string {
    if (params?.source === "user") return ` AND ${alias}.is_internal_query = 0`;
    if (params?.source === "internal") return ` AND ${alias}.is_internal_query = 1`;
    return "";
}

function waitCategoryFilter(
    params: Readonly<Record<string, unknown>> | undefined,
    alias = "ws",
): string {
    if (typeof params?.waitCategory !== "string" || params.waitCategory.trim().length === 0) {
        return "";
    }
    return ` AND ${alias}.wait_category_desc = ${textLiteral(params.waitCategory.trim())}`;
}

function positiveId(params: Readonly<Record<string, unknown>> | undefined, name: string): number {
    const value = params?.[name];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} is required and must be a positive safe integer.`);
    }
    return value;
}

function windowBoundary(
    params: Readonly<Record<string, unknown>> | undefined,
    key: string,
    fallback: string,
): string {
    const value = params?.[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") throw new Error(`Query Store ${key} must be an instant.`);
    return queryStoreReferenceSql({ referenceAt: normalizeInstant(value) });
}

function windowSql(
    params: Readonly<Record<string, unknown>> | undefined,
    startKey: string,
    endKey: string,
    fallbackStart: string,
    fallbackEnd = "@asOf",
    alias = "rsi",
): string {
    const hasStart = params?.[startKey] !== undefined;
    const hasEnd = params?.[endKey] !== undefined;
    if (hasStart !== hasEnd) {
        throw new Error(`Query Store ${startKey} and ${endKey} must be supplied together.`);
    }
    const start = windowBoundary(params, startKey, fallbackStart);
    const end = windowBoundary(params, endKey, fallbackEnd);
    return `${alias}.start_time >= ${start} AND ${alias}.start_time < ${end}`;
}

function intervalCountSql(
    params: Readonly<Record<string, unknown>> | undefined,
    startKey: string,
    endKey: string,
    fallbackStart: string,
    fallbackEnd = "@asOf",
): string {
    return `(SELECT COUNT(DISTINCT scope.runtime_stats_interval_id)
             FROM sys.query_store_runtime_stats_interval AS scope
             WHERE ${windowSql(params, startKey, endKey, fallbackStart, fallbackEnd, "scope")})`;
}

function metricExpressions(selected: QueryStoreMetric): {
    average: string;
    maximum: string;
    total: string;
} {
    if (selected === "executions") {
        return {
            average: "SUM(rs.count_executions)",
            maximum: "MAX(rs.count_executions)",
            total: "SUM(rs.count_executions)",
        };
    }
    const averageColumn =
        selected === "cpu"
            ? "rs.avg_cpu_time"
            : selected === "reads"
              ? "rs.avg_logical_io_reads"
              : "rs.avg_duration";
    const maximumColumn =
        selected === "cpu"
            ? "rs.max_cpu_time"
            : selected === "reads"
              ? "rs.max_logical_io_reads"
              : "rs.max_duration";
    return {
        average: `SUM(${averageColumn} * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0)`,
        maximum: `MAX(${maximumColumn})`,
        total: `SUM(${averageColumn} * rs.count_executions)`,
    };
}

function metricSampleColumns(selected: QueryStoreMetric): {
    average: string;
    stdev: string;
} {
    if (selected === "executions") {
        return { average: "1", stdev: "0" };
    }
    return {
        average:
            selected === "cpu"
                ? "rs.avg_cpu_time"
                : selected === "reads"
                  ? "rs.avg_logical_io_reads"
                  : "rs.avg_duration",
        stdev:
            selected === "cpu"
                ? "rs.stdev_cpu_time"
                : selected === "reads"
                  ? "rs.stdev_logical_io_reads"
                  : "rs.stdev_duration",
    };
}

export const topResourceConsumers: CatalogQuery = {
    id: "qds.topResourceConsumers",
    title: "Top resource consumers",
    description:
        "Successful executions aggregated by query across all plans over intervals starting in the selected window.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "source", header: "Source", width: 100 },
        { field: "plan_count", header: "Plans", format: "number", width: 80 },
        { field: "executions", header: "Executions", format: "number", width: 100 },
        { field: "total_duration_us", header: "Total duration", format: "duration-us", width: 130 },
        { field: "avg_duration_us", header: "Avg duration", format: "duration-us", width: 120 },
        { field: "avg_cpu_us", header: "Avg CPU", format: "duration-us", width: 110 },
        { field: "avg_logical_reads", header: "Avg reads", format: "number", width: 110 },
        { field: "selected_metric_total", header: "Selected total", format: "number", width: 130 },
        {
            field: "selected_metric_average",
            header: "Selected average",
            format: "number",
            width: 140,
        },
        {
            field: "selected_metric_maximum",
            header: "Selected maximum",
            format: "number",
            width: 140,
        },
        {
            field: "available_interval_count",
            header: "Retained intervals",
            format: "number",
            width: 130,
        },
        {
            field: "observed_interval_count",
            header: "Observed intervals",
            format: "number",
            width: 140,
        },
        { field: "first_interval_start", header: "First interval", format: "datetime", width: 160 },
        { field: "last_interval_start", header: "Last interval", format: "datetime", width: 160 },
        { field: "last_execution_time", header: "Last run", format: "datetime", width: 160 },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => {
        const selected = metric(params);
        const expressions = metricExpressions(selected);
        const availableIntervals = intervalCountSql(
            params,
            "startAt",
            "endAt",
            `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`,
        );
        const orderBy =
            aggregation(params) === "maximum"
                ? "selected_metric_maximum"
                : aggregation(params) === "total"
                  ? "selected_metric_total"
                  : "selected_metric_average";
        return `
DECLARE @asOf datetimeoffset = ${queryStoreReferenceSql(params)};
SELECT TOP (${topN(params, 50)})
    q.query_id,
    CASE WHEN q.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source,
    COUNT(DISTINCT p.plan_id) AS plan_count,
    SUM(rs.count_executions)                                        AS executions,
    SUM(rs.avg_duration * rs.count_executions)                      AS total_duration_us,
    SUM(rs.avg_duration * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0)                           AS avg_duration_us,
    SUM(rs.avg_cpu_time * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0)                           AS avg_cpu_us,
    SUM(rs.avg_logical_io_reads * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0)                   AS avg_logical_reads,
    ${expressions.total} AS selected_metric_total,
    ${expressions.average} AS selected_metric_average,
    ${expressions.maximum} AS selected_metric_maximum,
    ${availableIntervals} AS available_interval_count,
    COUNT(DISTINCT rsi.runtime_stats_interval_id) AS observed_interval_count,
    MIN(rsi.start_time)                                           AS first_interval_start,
    MAX(rsi.start_time)                                           AS last_interval_start,
    MAX(rs.last_execution_time)                                     AS last_execution_time,
    MIN(qt.query_sql_text)                                          AS query_sql_text
FROM sys.query_store_runtime_stats AS rs
JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
JOIN sys.query_store_plan  AS p  ON p.plan_id  = rs.plan_id
JOIN sys.query_store_query AS q  ON q.query_id = p.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE rs.execution_type ${executionTypes(params)}
    AND ${windowSql(params, "startAt", "endAt", `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`)}
    ${queryIdFilter(params)}
    ${queryTextFilter(params)}
    ${sourceFilter(params)}
GROUP BY q.query_id, q.is_internal_query
ORDER BY ${orderBy} DESC`;
    },
};

export const workloadHistory: CatalogQuery = {
    id: "qds.workloadHistory",
    title: "Workload history",
    description:
        "Execution-weighted workload evidence by retained Query Store aggregation interval.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "interval_start", header: "Interval", format: "datetime", width: 160 },
        { field: "interval_end", header: "Interval end", format: "datetime", width: 160 },
        { field: "executions", header: "Executions", format: "number", width: 110 },
        { field: "selected_metric_total", header: "Selected total", format: "number", width: 140 },
        {
            field: "selected_metric_average",
            header: "Selected average",
            format: "number",
            width: 150,
        },
        {
            field: "selected_metric_maximum",
            header: "Selected maximum",
            format: "number",
            width: 150,
        },
        {
            field: "available_interval_count",
            header: "Retained intervals",
            format: "number",
            width: 140,
        },
        {
            field: "observed_interval_count",
            header: "Observed intervals",
            format: "number",
            width: 140,
        },
    ],
    sql: (params) => {
        const selected = metric(params);
        const expressions = metricExpressions(selected);
        const start = `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`;
        const availableIntervals = intervalCountSql(params, "startAt", "endAt", start);
        return `
DECLARE @asOf datetimeoffset = ${queryStoreReferenceSql(params)};
SELECT TOP (${topN(params, 1000)})
    rsi.start_time AS interval_start,
    rsi.end_time AS interval_end,
    SUM(rs.count_executions) AS executions,
    ${expressions.total} AS selected_metric_total,
    ${expressions.average} AS selected_metric_average,
    ${expressions.maximum} AS selected_metric_maximum,
    ${availableIntervals} AS available_interval_count,
    COUNT(DISTINCT rsi.runtime_stats_interval_id) AS observed_interval_count
FROM sys.query_store_runtime_stats AS rs
JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
JOIN sys.query_store_query AS q ON q.query_id = p.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE rs.execution_type ${executionTypes(params)}
  AND ${windowSql(params, "startAt", "endAt", start)}
  ${queryIdFilter(params)}
  ${queryTextFilter(params)}
  ${sourceFilter(params)}
GROUP BY rsi.runtime_stats_interval_id, rsi.start_time, rsi.end_time
ORDER BY rsi.start_time`;
    },
};

export const waitStats: CatalogQuery = {
    id: "qds.waitStats",
    title: "Query Store waits",
    description:
        "Wait evidence by query and category, with execution denominators kept separate from wait rows.",
    platforms: [...QDS_PLATFORMS],
    minMajorVersion: 14,
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "source", header: "Source", width: 100 },
        { field: "wait_category", header: "Category", format: "number", width: 100 },
        { field: "wait_category_desc", header: "Wait category", width: 180 },
        { field: "executions", header: "Executions", format: "number", width: 110 },
        { field: "total_wait_ms", header: "Total wait", format: "duration-ms", width: 120 },
        { field: "avg_wait_ms", header: "Avg wait", format: "duration-ms", width: 110 },
        { field: "max_wait_ms", header: "Maximum wait", format: "duration-ms", width: 120 },
        {
            field: "available_interval_count",
            header: "Retained intervals",
            format: "number",
            width: 140,
        },
        {
            field: "observed_interval_count",
            header: "Observed intervals",
            format: "number",
            width: 150,
        },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => {
        const availableIntervals = intervalCountSql(
            params,
            "startAt",
            "endAt",
            `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`,
        );
        return `
DECLARE @asOf datetimeoffset = ${queryStoreReferenceSql(params)};
WITH execution_counts AS (
        SELECT p.query_id, q.is_internal_query, rsi.runtime_stats_interval_id, rs.execution_type,
                     SUM(rs.count_executions) AS executions
        FROM sys.query_store_runtime_stats AS rs
        JOIN sys.query_store_runtime_stats_interval AS rsi
            ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
        JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
        JOIN sys.query_store_query AS q ON q.query_id = p.query_id
        WHERE rs.execution_type ${executionTypes(params)}
            AND ${windowSql(params, "startAt", "endAt", `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`)}
            ${queryIdFilter(params)}
            ${sourceFilter(params)}
        GROUP BY p.query_id, q.is_internal_query, rsi.runtime_stats_interval_id, rs.execution_type
), wait_evidence AS (
        SELECT p.query_id, q.is_internal_query, ws.runtime_stats_interval_id, ws.execution_type,
                     ws.wait_category, ws.wait_category_desc,
                     SUM(ws.total_query_wait_time_ms) AS total_wait_ms,
                     MAX(ws.max_query_wait_time_ms) AS max_wait_ms
        FROM sys.query_store_wait_stats AS ws
        JOIN sys.query_store_plan AS p ON p.plan_id = ws.plan_id
        JOIN sys.query_store_query AS q ON q.query_id = p.query_id
        JOIN execution_counts AS e
            ON e.query_id = p.query_id
         AND e.is_internal_query = q.is_internal_query
         AND e.runtime_stats_interval_id = ws.runtime_stats_interval_id
         AND e.execution_type = ws.execution_type
        WHERE ws.execution_type ${executionTypes(params)}
            ${waitCategoryFilter(params)}
        GROUP BY p.query_id, q.is_internal_query, ws.runtime_stats_interval_id, ws.execution_type,
                         ws.wait_category, ws.wait_category_desc
)
SELECT TOP (${topN(params, 50)})
        w.query_id,
        CASE WHEN w.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source,
        w.wait_category,
        w.wait_category_desc,
        SUM(e.executions) AS executions,
        SUM(w.total_wait_ms) AS total_wait_ms,
        SUM(w.total_wait_ms) / NULLIF(SUM(e.executions), 0) AS avg_wait_ms,
        MAX(w.max_wait_ms) AS max_wait_ms,
        ${availableIntervals} AS available_interval_count,
        COUNT(DISTINCT w.runtime_stats_interval_id) AS observed_interval_count,
        MIN(qt.query_sql_text) AS query_sql_text
FROM wait_evidence AS w
JOIN execution_counts AS e
    ON e.query_id = w.query_id
 AND e.is_internal_query = w.is_internal_query
 AND e.runtime_stats_interval_id = w.runtime_stats_interval_id
 AND e.execution_type = w.execution_type
JOIN sys.query_store_query AS q ON q.query_id = w.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE 1 = 1
    ${queryTextFilter(params)}
GROUP BY w.query_id, w.is_internal_query, w.wait_category, w.wait_category_desc
ORDER BY total_wait_ms DESC`;
    },
};

/** The unranked workload view retains the same query-level evidence with the highest safe cap. */
export const allQueries: CatalogQuery = {
    ...topResourceConsumers,
    id: "qds.allQueries",
    title: "All queries",
    description:
        "Query-level workload evidence for all matching retained statements, subject to the result cap.",
    sql: (params) =>
        topResourceConsumers.sql({
            ...(params ?? {}),
            top: params?.top ?? 1000,
        }),
};

export const regressedQueries: CatalogQuery = {
    id: "qds.regressedQueries",
    title: "Regressed queries",
    description:
        "Successful executions compared across adjacent windows, assigned by aggregation-interval start. Multiple plans may contribute in either window.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "source", header: "Source", width: 100 },
        { field: "recent_avg_us", header: "Recent avg", format: "duration-us", width: 120 },
        { field: "baseline_avg_us", header: "Baseline avg", format: "duration-us", width: 120 },
        {
            field: "recent_selected_metric",
            header: "Recent selected",
            format: "number",
            width: 130,
        },
        {
            field: "baseline_selected_metric",
            header: "Baseline selected",
            format: "number",
            width: 140,
        },
        { field: "regression_factor", header: "Times slower", format: "number", width: 120 },
        { field: "recent_executions", header: "Recent runs", format: "number", width: 110 },
        { field: "baseline_executions", header: "Baseline runs", format: "number", width: 120 },
        { field: "recent_plan_count", header: "Recent plans", format: "number", width: 110 },
        { field: "baseline_plan_count", header: "Baseline plans", format: "number", width: 120 },
        {
            field: "recent_available_interval_count",
            header: "Recent retained intervals",
            format: "number",
            width: 170,
        },
        {
            field: "baseline_available_interval_count",
            header: "Baseline retained intervals",
            format: "number",
            width: 190,
        },
        {
            field: "recent_observed_interval_count",
            header: "Recent observed intervals",
            format: "number",
            width: 180,
        },
        {
            field: "baseline_observed_interval_count",
            header: "Baseline observed intervals",
            format: "number",
            width: 200,
        },
        {
            field: "recent_first_interval_start",
            header: "Recent first interval",
            format: "datetime",
            width: 170,
        },
        {
            field: "recent_last_interval_start",
            header: "Recent last interval",
            format: "datetime",
            width: 170,
        },
        {
            field: "baseline_first_interval_start",
            header: "Baseline first interval",
            format: "datetime",
            width: 180,
        },
        {
            field: "baseline_last_interval_start",
            header: "Baseline last interval",
            format: "datetime",
            width: 180,
        },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => {
        const selected = metric(params);
        const expressions = metricExpressions(selected);
        const recent = hours(params, "recentHours", 1);
        const baseline = hours(params, "baselineHours", recent);
        const rawMinimum = params?.minExecutions;
        const minExecutions =
            typeof rawMinimum === "number" && Number.isSafeInteger(rawMinimum) && rawMinimum > 0
                ? rawMinimum
                : 5;
        return `
DECLARE @asOf datetimeoffset = ${queryStoreReferenceSql(params)};
WITH recent AS (
    SELECT p.query_id,
            CASE WHEN q.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source,
           SUM(rs.count_executions)                    AS executions,
           SUM(rs.avg_duration * rs.count_executions)
             / NULLIF(SUM(rs.count_executions), 0)     AS avg_duration_us,
                     ${expressions.average}                      AS selected_metric,
                     COUNT(DISTINCT rs.plan_id)                  AS plan_count,
                     ${intervalCountSql(
                         params,
                         "startAt",
                         "endAt",
                         `DATEADD(hour, -${recent}, @asOf)`,
                     )} AS available_interval_count,
                     COUNT(DISTINCT rsi.runtime_stats_interval_id) AS observed_interval_count,
                     MIN(rsi.start_time) AS first_interval_start,
                     MAX(rsi.start_time) AS last_interval_start
    FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
    JOIN sys.query_store_query AS q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
        WHERE rs.execution_type ${executionTypes(params)}
            AND ${windowSql(params, "startAt", "endAt", `DATEADD(hour, -${recent}, @asOf)`)}
            ${queryIdFilter(params, "p")}
            ${queryTextFilter(params)}
            ${sourceFilter(params)}
    GROUP BY p.query_id, q.is_internal_query
),
baseline AS (
    SELECT p.query_id,
           CASE WHEN q.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source,
           SUM(rs.count_executions)                    AS executions,
           SUM(rs.avg_duration * rs.count_executions)
             / NULLIF(SUM(rs.count_executions), 0)     AS avg_duration_us,
                     ${expressions.average}                      AS selected_metric,
                     COUNT(DISTINCT rs.plan_id)                  AS plan_count,
                     ${intervalCountSql(
                         params,
                         "baselineStartAt",
                         "baselineEndAt",
                         `DATEADD(hour, -${recent + baseline}, @asOf)`,
                         `DATEADD(hour, -${recent}, @asOf)`,
                     )} AS available_interval_count,
                     COUNT(DISTINCT rsi.runtime_stats_interval_id) AS observed_interval_count,
                     MIN(rsi.start_time) AS first_interval_start,
                     MAX(rsi.start_time) AS last_interval_start
    FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
    JOIN sys.query_store_query AS q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
        WHERE rs.execution_type ${executionTypes(params)}
            AND ${windowSql(
                params,
                "baselineStartAt",
                "baselineEndAt",
                `DATEADD(hour, -${recent + baseline}, @asOf)`,
                `DATEADD(hour, -${recent}, @asOf)`,
            )}
            ${queryIdFilter(params, "p")}
            ${queryTextFilter(params)}
                ${sourceFilter(params)}
            GROUP BY p.query_id, q.is_internal_query
)
SELECT TOP (${topN(params, 50)})
    r.query_id,
            r.source,
    r.avg_duration_us                          AS recent_avg_us,
    b.avg_duration_us                          AS baseline_avg_us,
    r.selected_metric                           AS recent_selected_metric,
    b.selected_metric                           AS baseline_selected_metric,
    r.selected_metric / NULLIF(b.selected_metric, 0) AS regression_factor,
    r.executions                                                AS recent_executions,
    b.executions                                                AS baseline_executions,
    r.plan_count                                                AS recent_plan_count,
    b.plan_count                                                AS baseline_plan_count,
    r.available_interval_count                                  AS recent_available_interval_count,
    b.available_interval_count                                  AS baseline_available_interval_count,
    r.observed_interval_count                                   AS recent_observed_interval_count,
    b.observed_interval_count                                   AS baseline_observed_interval_count,
    r.first_interval_start                                      AS recent_first_interval_start,
    r.last_interval_start                                       AS recent_last_interval_start,
    b.first_interval_start                                      AS baseline_first_interval_start,
    b.last_interval_start                                       AS baseline_last_interval_start,
    qt.query_sql_text
FROM recent AS r
JOIN baseline AS b ON b.query_id = r.query_id
JOIN sys.query_store_query AS q ON q.query_id = r.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE r.executions >= ${minExecutions}
  AND b.executions >= ${minExecutions}
    AND r.selected_metric > b.selected_metric * 1.5
ORDER BY regression_factor DESC`;
    },
};

export const highVariationQueries: CatalogQuery = {
    id: "qds.highVariation",
    title: "High variation queries",
    description:
        "Duration variation across successful executions, including variation within and between aggregation intervals and plans. Variation alone does not establish a cause.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "source", header: "Source", width: 100 },
        { field: "executions", header: "Executions", format: "number", width: 100 },
        { field: "avg_duration_us", header: "Avg duration", format: "duration-us", width: 120 },
        { field: "stdev_duration_us", header: "Std deviation", format: "duration-us", width: 130 },
        {
            field: "selected_metric_average",
            header: "Selected average",
            format: "number",
            width: 140,
        },
        { field: "variation_coefficient", header: "Variation", format: "number", width: 100 },
        {
            field: "available_interval_count",
            header: "Retained intervals",
            format: "number",
            width: 130,
        },
        {
            field: "observed_interval_count",
            header: "Observed intervals",
            format: "number",
            width: 140,
        },
        { field: "first_interval_start", header: "First interval", format: "datetime", width: 160 },
        { field: "last_interval_start", header: "Last interval", format: "datetime", width: 160 },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => {
        const selected = metric(params);
        const sample = metricSampleColumns(selected);
        return `
DECLARE @asOf datetimeoffset = ${queryStoreReferenceSql(params)};
WITH samples AS (
        SELECT p.query_id,
            CASE WHEN q.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source,
            rs.count_executions, ${sample.average} AS selected_average, ${sample.stdev} AS selected_stdev,
            rs.avg_duration, rs.stdev_duration, rsi.runtime_stats_interval_id AS interval_id,
            rsi.start_time AS interval_start
    FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
    JOIN sys.query_store_query AS q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
    WHERE rs.execution_type ${executionTypes(params)} AND rs.count_executions > 0
      AND ${windowSql(params, "startAt", "endAt", `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`)}
    ${queryIdFilter(params, "q")}
      ${queryTextFilter(params)}
    ${sourceFilter(params)}
), means AS (
    SELECT query_id, source, SUM(count_executions) AS executions,
        SUM(count_executions * avg_duration) / NULLIF(SUM(count_executions), 0) AS avg_duration_us
        , SUM(count_executions * selected_average) / NULLIF(SUM(count_executions), 0) AS selected_metric_average,
        ${intervalCountSql(
            params,
            "startAt",
            "endAt",
            `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`,
        )} AS available_interval_count,
        COUNT(DISTINCT interval_id) AS observed_interval_count,
        MIN(interval_start) AS first_interval_start,
        MAX(interval_start) AS last_interval_start
    FROM samples GROUP BY query_id, source
), pooled AS (
    SELECT m.query_id, m.source, m.executions, m.avg_duration_us, m.selected_metric_average,
        m.available_interval_count, m.observed_interval_count, m.first_interval_start, m.last_interval_start,
        SQRT(SUM(s.count_executions * (POWER(s.selected_stdev, 2) + POWER(s.selected_average - m.selected_metric_average, 2)))
            / NULLIF(m.executions, 0)) AS stdev_duration_us
    FROM means AS m JOIN samples AS s ON s.query_id = m.query_id AND s.source = m.source
    WHERE m.executions >= 5 AND m.avg_duration_us > 0
    GROUP BY m.query_id, m.source, m.executions, m.avg_duration_us, m.selected_metric_average,
        m.available_interval_count, m.observed_interval_count, m.first_interval_start, m.last_interval_start
)
SELECT TOP (${topN(params, 50)})
    p.query_id, p.source, p.executions, p.avg_duration_us, p.stdev_duration_us, p.selected_metric_average,
    p.stdev_duration_us / NULLIF(p.selected_metric_average, 0) AS variation_coefficient,
    p.available_interval_count, p.observed_interval_count, p.first_interval_start, p.last_interval_start,
    qt.query_sql_text
FROM pooled AS p
JOIN sys.query_store_query AS q ON q.query_id = p.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
ORDER BY variation_coefficient DESC`;
    },
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
        { field: "source", header: "Source", width: 100 },
        { field: "plan_id", header: "Plan", format: "number", width: 80 },
        { field: "force_failure_count", header: "Force failures", format: "number", width: 120 },
        { field: "last_force_failure_reason_desc", header: "Failure reason", width: 200 },
        { field: "last_execution_time", header: "Last run", format: "datetime", width: 160 },
        { field: "query_sql_text", header: "Statement", wide: true },
    ],
    sql: (params) => `
SELECT
    q.query_id, CASE WHEN q.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source,
    p.plan_id, p.force_failure_count, p.last_force_failure_reason_desc,
    p.last_execution_time, qt.query_sql_text
FROM sys.query_store_plan AS p
JOIN sys.query_store_query AS q ON q.query_id = p.query_id
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE p.is_forced_plan = 1
    ${sourceFilter(params)}
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
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "plan_id", header: "Plan", format: "number", width: 80 },
        { field: "is_forced_plan", header: "Forced", format: "number", width: 90 },
        { field: "force_failure_count", header: "Force failures", format: "number", width: 120 },
        { field: "last_force_failure_reason_desc", header: "Force failure", width: 220 },
        { field: "query_plan", header: "Showplan XML", wide: true },
    ],
    sql: (params) => {
        const planId = positiveId(params, "planId");
        const queryId = positiveId(params, "queryId");
        return `SELECT query_id, plan_id, is_forced_plan, force_failure_count, last_force_failure_reason_desc, CONVERT(nvarchar(max), query_plan) AS query_plan FROM sys.query_store_plan WHERE query_id = ${queryId} AND plan_id = ${planId}`;
    },
};

export const plansForQueryStoreQuery: CatalogQuery = {
    id: "qds.queryPlans",
    title: "Plans for a Query Store query",
    description: "Stored plans for one explicit Query Store query, ordered by observed evidence.",
    platforms: [...QDS_PLATFORMS],
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "plan_id", header: "Plan", format: "number", width: 80 },
        { field: "is_forced_plan", header: "Forced", format: "number", width: 90 },
        { field: "force_failure_count", header: "Force failures", format: "number", width: 120 },
        { field: "last_force_failure_reason_desc", header: "Force failure", width: 220 },
        {
            field: "first_compile_start_time",
            header: "First observed",
            format: "datetime",
            width: 160,
        },
        {
            field: "last_compile_start_time",
            header: "Last observed",
            format: "datetime",
            width: 160,
        },
        { field: "executions", header: "Executions", format: "number", width: 110 },
        { field: "total_duration_us", header: "Total duration", format: "duration-us", width: 130 },
        { field: "avg_duration_us", header: "Avg duration", format: "duration-us", width: 120 },
        { field: "selected_metric_total", header: "Selected total", format: "number", width: 130 },
        {
            field: "selected_metric_average",
            header: "Selected average",
            format: "number",
            width: 140,
        },
        {
            field: "selected_metric_maximum",
            header: "Selected maximum",
            format: "number",
            width: 140,
        },
        {
            field: "observed_interval_count",
            header: "Observed intervals",
            format: "number",
            width: 140,
        },
        { field: "first_interval_start", header: "First interval", format: "datetime", width: 160 },
        { field: "last_interval_start", header: "Last interval", format: "datetime", width: 160 },
        { field: "last_execution_time", header: "Last run", format: "datetime", width: 160 },
    ],
    sql: (params) => {
        const queryId = positiveId(params, "queryId");
        const selected = metric(params);
        const expressions = metricExpressions(selected);
        return `
DECLARE @asOf datetimeoffset = ${queryStoreReferenceSql(params)};
WITH plan_evidence AS (
    SELECT rs.plan_id,
           SUM(rs.count_executions) AS executions,
           SUM(rs.avg_duration * rs.count_executions) AS total_duration_us,
           SUM(rs.avg_duration * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0) AS avg_duration_us,
           ${expressions.total} AS selected_metric_total,
           ${expressions.average} AS selected_metric_average,
           ${expressions.maximum} AS selected_metric_maximum,
           COUNT(DISTINCT rsi.runtime_stats_interval_id) AS observed_interval_count,
           MIN(rsi.start_time) AS first_interval_start,
           MAX(rsi.start_time) AS last_interval_start,
           MAX(rs.last_execution_time) AS last_execution_time
    FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    WHERE rs.execution_type ${executionTypes(params)}
      AND rs.count_executions > 0
      AND ${windowSql(
          params,
          "startAt",
          "endAt",
          `DATEADD(hour, -${hours(params, "hours", 24)}, @asOf)`,
      )}
    GROUP BY rs.plan_id
)
SELECT p.query_id, p.plan_id, p.is_forced_plan, p.force_failure_count, p.last_force_failure_reason_desc,
       p.first_compile_start_time, p.last_compile_start_time,
       COALESCE(e.executions, 0) AS executions,
       e.total_duration_us, e.avg_duration_us, e.selected_metric_total, e.selected_metric_average,
       e.selected_metric_maximum, e.observed_interval_count, e.first_interval_start,
       e.last_interval_start, e.last_execution_time
FROM sys.query_store_plan AS p
LEFT JOIN plan_evidence AS e ON e.plan_id = p.plan_id
WHERE p.query_id = ${queryId}
ORDER BY e.last_execution_time DESC, p.last_compile_start_time DESC, p.plan_id DESC`;
    },
};

export const queryStoreHints: CatalogQuery = {
    id: "qds.queryHints",
    title: "Query Store hints",
    description: "The effective Query Store hint and any server-reported application failure.",
    platforms: [...QDS_PLATFORMS],
    minMajorVersion: 16,
    requiresCapability: "hasQueryStore",
    requiresQueryStore: true,
    requiresPermission: "VIEW DATABASE STATE",
    columns: [
        { field: "query_id", header: "Query", format: "number", width: 90 },
        { field: "query_hint_id", header: "Hint", format: "number", width: 90 },
        { field: "query_hints", header: "Hint text", wide: true },
        { field: "source_desc", header: "Source", width: 150 },
        { field: "state_desc", header: "State", width: 120 },
        { field: "last_query_hint_failure_reason_desc", header: "Failure reason", width: 220 },
    ],
    sql: (params) => {
        const queryId = positiveId(params, "queryId");
        return `SELECT query_id, query_hint_id, query_hints, source_desc, state_desc, last_query_hint_failure_reason_desc FROM sys.query_store_query_hints WHERE query_id = ${queryId}`;
    },
};

export const queryStoreQueries: readonly CatalogQuery[] = [
    topResourceConsumers,
    workloadHistory,
    allQueries,
    waitStats,
    regressedQueries,
    highVariationQueries,
    forcedPlans,
    queryStoreHints,
    plansForQueryStoreQuery,
];
