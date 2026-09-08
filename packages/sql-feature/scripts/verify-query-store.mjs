/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Read-only verification using table-variable fixtures in a local development SQL Server.
// Usage: npm run build && node scripts/verify-query-store.mjs <docker-container>
import { spawnSync } from "node:child_process";
import {
    topResourceConsumers,
    regressedQueries,
    highVariationQueries,
    waitStats,
} from "../dist/diagnostics/querystore/index.js";

const container = process.argv[2];
if (!container) throw new Error("Supply the development SQL Server container name.");
const fixture = `
SET NOCOUNT ON;
DECLARE @now datetimeoffset = SYSUTCDATETIME();
DECLARE @runtime TABLE (plan_id bigint, runtime_stats_interval_id bigint, execution_type int,
 count_executions bigint, avg_duration float, max_duration float, stdev_duration float,
 avg_cpu_time float, max_cpu_time float, avg_logical_io_reads float,
 max_logical_io_reads float, last_execution_time datetimeoffset);
DECLARE @intervals TABLE (runtime_stats_interval_id bigint, start_time datetimeoffset, end_time datetimeoffset);
DECLARE @plans TABLE (plan_id bigint, query_id bigint);
DECLARE @queries TABLE (query_id bigint, query_text_id bigint, is_internal_query bit);
DECLARE @texts TABLE (query_text_id bigint, query_sql_text nvarchar(max));
DECLARE @waits TABLE (plan_id bigint, runtime_stats_interval_id bigint, execution_type int,
 wait_category int, wait_category_desc varchar(64), total_query_wait_time_ms float,
 avg_query_wait_time_ms float, last_query_wait_time_ms float, min_query_wait_time_ms float,
 max_query_wait_time_ms float, stdev_query_wait_time_ms float);
INSERT @intervals VALUES (1, DATEADD(minute,-30,@now), DATEADD(minute,30,@now)),
 (2, DATEADD(minute,-90,@now), DATEADD(minute,-30,@now));
INSERT @plans VALUES (7,1),(99,1);
INSERT @queries VALUES (1,1,0);
INSERT @texts VALUES (1,N'SELECT fixture');
INSERT @waits VALUES
 (7,1,0,2,'Lock',100,10,20,5,40,0),
 (7,1,0,1,'CPU',50,5,10,2,20,0);
-- Two rows for the same plan/interval model separate persisted and in-memory statistics.
INSERT @runtime VALUES
 (7,1,0,1,100,100,0,50,50,2,2,@now),
 (7,1,0,9,10,10,0,5,5,4,4,@now),
 (99,2,0,10,2,2,0,1,1,1,1,DATEADD(minute,-60,@now)),
 (7,1,3,1000,10000,10000,0,10000,10000,10000,10000,@now);
`;
function substitute(sql) {
    return sql
        .replaceAll("sys.query_store_runtime_stats_interval", "@intervals")
        .replaceAll("sys.query_store_runtime_stats", "@runtime")
        .replaceAll("sys.query_store_query_text", "@texts")
        .replaceAll("sys.query_store_query", "@queries")
        .replaceAll("sys.query_store_plan", "@plans")
        .replaceAll("sys.query_store_wait_stats", "@waits")
        .replace(/SELECT TOP \(/, "INSERT INTO @actual SELECT TOP (");
}
const cases = [
    {
        name: "weighted means and successful execution filtering",
        query: topResourceConsumers,
        columns:
            "query_id bigint, source varchar(8), plan_count int, executions bigint, total_duration_us float, avg_duration_us float, avg_cpu_us float, avg_logical_reads float, selected_metric_total float, selected_metric_average float, selected_metric_maximum float, available_interval_count int, observed_interval_count int, first_interval_start datetimeoffset, last_interval_start datetimeoffset, last_execution_time datetimeoffset, query_sql_text nvarchar(max)",
        predicate:
            "executions = 10 AND ABS(total_duration_us-190)<0.000001 AND ABS(avg_duration_us-19)<0.000001 AND ABS(avg_cpu_us-9.5)<0.000001 AND ABS(avg_logical_reads-3.8)<0.000001",
    },
    {
        name: "pooled variation across split runtime rows",
        query: highVariationQueries,
        columns:
            "query_id bigint, source varchar(8), executions bigint, avg_duration_us float, stdev_duration_us float, selected_metric_average float, variation_coefficient float, available_interval_count int, observed_interval_count int, first_interval_start datetimeoffset, last_interval_start datetimeoffset, query_sql_text nvarchar(max)",
        predicate:
            "executions = 10 AND ABS(avg_duration_us-19)<0.000001 AND ABS(stdev_duration_us-27)<0.000001",
    },
    {
        name: "adjacent regression windows and plan counts",
        query: regressedQueries,
        columns:
            "query_id bigint, source varchar(8), recent_avg_us float, baseline_avg_us float, recent_selected_metric float, baseline_selected_metric float, regression_factor float, recent_executions bigint, baseline_executions bigint, recent_plan_count int, baseline_plan_count int, recent_available_interval_count int, baseline_available_interval_count int, recent_observed_interval_count int, baseline_observed_interval_count int, recent_first_interval_start datetimeoffset, recent_last_interval_start datetimeoffset, baseline_first_interval_start datetimeoffset, baseline_last_interval_start datetimeoffset, query_sql_text nvarchar(max)",
        predicate:
            "recent_executions=10 AND baseline_executions=10 AND recent_avg_us=19 AND baseline_avg_us=2 AND regression_factor=9.5 AND recent_plan_count=1 AND baseline_plan_count=1",
    },
];
cases.push({
    ...cases[0],
    name: "top consumers combine different plans into one query",
    setup: "INSERT @plans VALUES (3,1); UPDATE @runtime SET plan_id=3 WHERE avg_duration=10;",
    predicate: `${cases[0].predicate} AND plan_count=2`,
});
cases.push({
    name: "wait categories keep execution denominators separate",
    query: waitStats,
    columns:
        "query_id bigint, source varchar(8), wait_category int, wait_category_desc varchar(64), executions bigint, total_wait_ms float, avg_wait_ms float, max_wait_ms float, available_interval_count int, observed_interval_count int, query_sql_text nvarchar(max)",
    predicate:
        "executions=10 AND wait_category_desc='Lock' AND ABS(total_wait_ms-100)<0.000001 AND ABS(avg_wait_ms-10)<0.000001 AND max_wait_ms=40",
    params: { hours: 1, waitCategory: "Lock" },
});
for (const scenario of cases) {
    const sql = `${fixture}\n${scenario.setup ?? ""}\nDECLARE @actual TABLE (${scenario.columns});\n${substitute(scenario.query.sql({ hours: 1, recentHours: 1, baselineHours: 1, ...(scenario.params ?? {}) }))};\nIF (SELECT COUNT(*) FROM @actual) <> 1 OR NOT EXISTS (SELECT 1 FROM @actual WHERE ${scenario.predicate}) THROW 51000, 'Query Store aggregation fixture failed', 1;`;
    const result = spawnSync(
        "docker",
        [
            "exec",
            "-i",
            container,
            "bash",
            "-lc",
            'export SQLCMDPASSWORD="${MSSQL_SA_PASSWORD:-$SA_PASSWORD}"; /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b',
        ],
        { input: sql, encoding: "utf8" },
    );
    if (result.status !== 0)
        throw new Error(`${scenario.name}: ${result.stdout}\n${result.stderr}`);
    process.stdout.write(`PASS ${scenario.name}\n`);
}
