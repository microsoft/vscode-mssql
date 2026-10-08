/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * The expected Query Store report queries, copied from the SQL Tools Service integration tests
 * (test/Microsoft.SqlTools.ServiceLayer.IntegrationTests/QueryStore/QueryStoreBaselines.cs). Each
 * name is the C# constant name with a lowercase first letter. QueryStoreTests.cs in the same
 * folder has the configuration for each one. The text is unchanged, including trailing spaces;
 * only the line endings are "\n".
 *
 * This folder is outside test/ so that the Node.js test runner does not run it as a test file.
 */

module.exports = {
    handleGetTopResourceConsumersSummaryReportRequest: `DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';

WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.wait_category,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2) min_query_wait_time,
    ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2) max_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)

GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category
)
SELECT 
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (ws.first_execution_time > @interval_end_time OR ws.last_execution_time < @interval_start_time)

GROUP BY p.query_id, qt.query_sql_text, q.object_id
HAVING COUNT(distinct p.plan_id) >= 1
ORDER BY query_id DESC`,
    handleGetTopResourceConsumersDetailedSummaryReportRequest: `DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';

WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.wait_category,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)

GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category
),
top_wait_stats AS
(
SELECT 
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (ws.first_execution_time > @interval_end_time OR ws.last_execution_time < @interval_start_time)

GROUP BY p.query_id, qt.query_sql_text, q.object_id 
),
top_other_stats AS
(
SELECT 
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_clr_time*rs.stdev_clr_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_clr_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_cpu_time*rs.stdev_cpu_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_cpu_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_dop*rs.stdev_dop*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_dop,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_duration,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_reads*rs.stdev_logical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_writes*rs.stdev_logical_io_writes*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_writes,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_log_bytes_used*rs.stdev_log_bytes_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.0009765625,2) stdev_log_bytes_used,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_query_max_used_memory*rs.stdev_query_max_used_memory*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_query_max_used_memory,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_physical_io_reads*rs.stdev_physical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_physical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_rowcount*rs.stdev_rowcount*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_rowcount,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_tempdb_space_used*rs.stdev_tempdb_space_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_tempdb_space_used,
    SUM(rs.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_runtime_stats rs
    JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (rs.first_execution_time > @interval_end_time OR rs.last_execution_time < @interval_start_time)

GROUP BY p.query_id, qt.query_sql_text, q.object_id 
)
SELECT 
    A.query_id query_id,
    A.object_id object_id,
    A.object_name object_name,
    A.query_sql_text query_sql_text,
    A.stdev_clr_time stdev_clr_time,
    A.stdev_cpu_time stdev_cpu_time,
    A.stdev_dop stdev_dop,
    A.stdev_duration stdev_duration,
    A.stdev_logical_io_reads stdev_logical_io_reads,
    A.stdev_logical_io_writes stdev_logical_io_writes,
    A.stdev_log_bytes_used stdev_log_bytes_used,
    A.stdev_query_max_used_memory stdev_query_max_used_memory,
    A.stdev_physical_io_reads stdev_physical_io_reads,
    A.stdev_rowcount stdev_rowcount,
    A.stdev_tempdb_space_used stdev_tempdb_space_used,
    ISNULL(B.stdev_query_wait_time,0) stdev_query_wait_time,
    A.count_executions count_executions,
    A.num_plans num_plans
FROM top_other_stats A LEFT JOIN top_wait_stats B on A.query_id = B.query_id and A.query_sql_text = B.query_sql_text and A.object_id = B.object_id
WHERE A.num_plans >= 1
ORDER BY query_id DESC`,
    handleGetForcedPlanQueriesReportRequest: `WITH
A AS
(
SELECT
    p.query_id query_id,
    qt.query_sql_text query_sql_text,
    p.plan_id plan_id,
    p.force_failure_count force_failure_count,
    p.last_force_failure_reason_desc last_force_failure_reason_desc,
    p.last_execution_time last_execution_time,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    p.last_compile_start_time last_compile_start_time
FROM sys.query_store_plan p
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
where p.is_forced_plan = 1
),
B AS
(
SELECT
    p.query_id query_id,
    MAX(p.last_execution_time) last_execution_time,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_plan p
GROUP BY p.query_id
HAVING MAX(CAST(p.is_forced_plan AS tinyint)) = 1
)
SELECT 
    A.query_id,
    A.query_sql_text,
    A.plan_id,
    A.force_failure_count,
    A.last_compile_start_time,
    A.last_force_failure_reason_desc,
    B.num_plans,
    B.last_execution_time,
    A.last_execution_time,
    A.object_id,
    A.object_name
FROM A JOIN B ON A.query_id = B.query_id
WHERE B.num_plans >= 1
ORDER BY query_id DESC`,
    handleGetTrackedQueriesReportRequest: `DECLARE @QuerySearchText NVARCHAR(max) = N'test search text';

SELECT TOP 500 q.query_id, q.query_text_id, qt.query_sql_text 
FROM sys.query_store_query_text qt JOIN sys.query_store_query q ON q.query_text_id = qt.query_text_id 
WHERE qt.query_sql_text LIKE ('%' + @QuerySearchText + '%')`,
    handleGetHighVariationQueriesSummaryReportRequest: `DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';

WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.wait_category,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2) min_query_wait_time,
    ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2) max_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)

GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category
)
SELECT 
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.avg_query_wait_time*ws.count_executions))/NULLIF(SUM(ws.count_executions), 0)*1,2) avg_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (ws.first_execution_time > @interval_end_time OR ws.last_execution_time < @interval_start_time)

GROUP BY p.query_id, qt.query_sql_text, q.object_id
HAVING COUNT(distinct p.plan_id) >= 1 AND SUM(ws.count_executions) > 1
ORDER BY query_id DESC`,
    handleGetHighVariationQueriesDetailedSummaryReportRequest: `DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';

WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.wait_category,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)

GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category
),
wait_stats_variation AS
(
SELECT 
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (ws.first_execution_time > @interval_end_time OR ws.last_execution_time < @interval_start_time)

GROUP BY p.query_id, qt.query_sql_text, q.object_id 
),
other_stats_variation AS
(
SELECT 
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_clr_time*rs.stdev_clr_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_clr_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_cpu_time*rs.stdev_cpu_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_cpu_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_dop*rs.stdev_dop*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_dop,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_duration,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_reads*rs.stdev_logical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_writes*rs.stdev_logical_io_writes*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_writes,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_log_bytes_used*rs.stdev_log_bytes_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.0009765625,2) stdev_log_bytes_used,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_query_max_used_memory*rs.stdev_query_max_used_memory*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_query_max_used_memory,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_physical_io_reads*rs.stdev_physical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_physical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_rowcount*rs.stdev_rowcount*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_rowcount,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_tempdb_space_used*rs.stdev_tempdb_space_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_tempdb_space_used,
    SUM(rs.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_runtime_stats rs
    JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (rs.first_execution_time > @interval_end_time OR rs.last_execution_time < @interval_start_time)

GROUP BY p.query_id, qt.query_sql_text, q.object_id 
)
SELECT 
    A.query_id query_id,
    A.object_id object_id,
    A.object_name object_name,
    A.query_sql_text query_sql_text,
    A.stdev_clr_time stdev_clr_time,
    A.stdev_cpu_time stdev_cpu_time,
    A.stdev_dop stdev_dop,
    A.stdev_duration stdev_duration,
    A.stdev_logical_io_reads stdev_logical_io_reads,
    A.stdev_logical_io_writes stdev_logical_io_writes,
    A.stdev_log_bytes_used stdev_log_bytes_used,
    A.stdev_query_max_used_memory stdev_query_max_used_memory,
    A.stdev_physical_io_reads stdev_physical_io_reads,
    A.stdev_rowcount stdev_rowcount,
    A.stdev_tempdb_space_used stdev_tempdb_space_used,
    ISNULL(B.stdev_query_wait_time,0) stdev_query_wait_time,
    A.count_executions count_executions,
    A.num_plans num_plans
FROM other_stats_variation A LEFT JOIN wait_stats_variation B on A.query_id = B.query_id and A.query_sql_text = B.query_sql_text and A.object_id = B.object_id
WHERE A.num_plans >= 1 AND A.count_executions > 1
ORDER BY query_id DESC`,
    handleGetOverallResourceConsumptionReportRequest: `DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';

WITH DateGenerator AS
(
SELECT CAST(@interval_start_time AS DATETIME) DatePlaceHolder
UNION ALL
SELECT  DATEADD(hh, 1, DatePlaceHolder)
FROM    DateGenerator
WHERE   DATEADD(hh, 1, DatePlaceHolder) < @interval_end_time
), WaitStats AS
(
SELECT
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)

GROUP BY DATEDIFF(hh, 0, itvl.end_time)
),
UnionAll AS
(
SELECT
    ROUND(CONVERT(float, SUM(rs.avg_clr_time*rs.count_executions))*0.001,2) as total_clr_time,
    ROUND(CONVERT(float, SUM(rs.avg_cpu_time*rs.count_executions))*0.001,2) as total_cpu_time,
    ROUND(CONVERT(float, SUM(rs.avg_dop*rs.count_executions))*1,0) as total_dop,
    ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))*0.001,2) as total_duration,
    CONVERT(float, SUM(rs.count_executions)) as total_count_executions,
    ROUND(CONVERT(float, SUM(rs.avg_logical_io_reads*rs.count_executions))*8,2) as total_logical_io_reads,
    ROUND(CONVERT(float, SUM(rs.avg_logical_io_writes*rs.count_executions))*8,2) as total_logical_io_writes,
    ROUND(CONVERT(float, SUM(rs.avg_log_bytes_used*rs.count_executions))*0.0009765625,2) as total_log_bytes_used,
    ROUND(CONVERT(float, SUM(rs.avg_query_max_used_memory*rs.count_executions))*8,2) as total_query_max_used_memory,
    ROUND(CONVERT(float, SUM(rs.avg_physical_io_reads*rs.count_executions))*8,2) as total_physical_io_reads,
    ROUND(CONVERT(float, SUM(rs.avg_rowcount*rs.count_executions))*1,0) as total_rowcount,
    ROUND(CONVERT(float, SUM(rs.avg_tempdb_space_used*rs.count_executions))*8,2) as total_tempdb_space_used,
    TODATETIMEOFFSET(DATEADD(hh, ((DATEDIFF(hh, 0, rs.last_execution_time))), 0), DATEPART(tz, @interval_start_time)) as bucket_start,
    TODATETIMEOFFSET(DATEADD(hh, (1 + (DATEDIFF(hh, 0, rs.last_execution_time))), 0), DATEPART(tz, @interval_start_time)) as bucket_end
FROM sys.query_store_runtime_stats rs
WHERE 
    NOT (rs.first_execution_time > @interval_end_time OR rs.last_execution_time < @interval_start_time)

GROUP BY DATEDIFF(hh, 0, rs.last_execution_time)
)
SELECT 
    total_clr_time,
    total_cpu_time,
    total_dop,
    total_duration,
    total_count_executions,
    total_logical_io_reads,
    total_logical_io_writes,
    total_log_bytes_used,
    total_query_max_used_memory,
    total_physical_io_reads,
    total_rowcount,
    total_tempdb_space_used,
    total_query_wait_time,
    bucket_start,
    bucket_end
FROM
(
SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket_start ORDER BY bucket_start, total_duration DESC) AS RowNumber
FROM UnionAll , WaitStats
) as UnionAllResults
WHERE UnionAllResults.RowNumber = 1
OPTION (MAXRECURSION 0)`,
    handleGetRegressedQueriesSummaryReportRequest: `DECLARE @recent_start_time DATETIMEOFFSET = '2023-06-17T11:34:56.0000000+00:00';
DECLARE @recent_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';
DECLARE @history_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @history_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';
DECLARE @min_exec_count BIGINT = 1;

WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.wait_category,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2) min_query_wait_time,
    ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2) max_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @history_end_time OR itvl.end_time < @history_start_time)

GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category
),
hist AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
WHERE
    NOT (ws.first_execution_time > @history_end_time OR ws.last_execution_time < @history_start_time)

GROUP BY p.query_id
),
recent AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
WHERE
    NOT (ws.first_execution_time > @recent_end_time OR ws.last_execution_time < @recent_start_time)

GROUP BY p.query_id
)
SELECT 
    results.query_id query_id,
    results.object_id object_id,
    ISNULL(OBJECT_NAME(results.object_id),'') object_name,
    results.query_sql_text query_sql_text,
    results.query_wait_time_regr_perc_recent query_wait_time_regr_perc_recent,
    results.stdev_query_wait_time_recent stdev_query_wait_time_recent,
    results.stdev_query_wait_time_hist stdev_query_wait_time_hist,
    ISNULL(results.count_executions_recent, 0) count_executions_recent,
    ISNULL(results.count_executions_hist, 0) count_executions_hist,
    queries.num_plans num_plans
FROM
(
SELECT
    hist.query_id query_id,
    q.object_id object_id,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, recent.stdev_query_wait_time-hist.stdev_query_wait_time)/NULLIF(hist.stdev_query_wait_time,0)*100.0, 2) query_wait_time_regr_perc_recent,
    ROUND(recent.stdev_query_wait_time, 2) stdev_query_wait_time_recent,
    ROUND(hist.stdev_query_wait_time, 2) stdev_query_wait_time_hist,
    recent.count_executions count_executions_recent,
    hist.count_executions count_executions_hist
FROM hist
    JOIN recent ON hist.query_id = recent.query_id
    JOIN sys.query_store_query q ON q.query_id = hist.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    recent.count_executions >= @min_exec_count
) AS results
JOIN
(
SELECT
    p.query_id query_id,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_plan p
GROUP BY p.query_id
HAVING COUNT(distinct p.plan_id) >= 1
) AS queries ON queries.query_id = results.query_id
WHERE query_wait_time_regr_perc_recent > 0
OPTION (MERGE JOIN)`,
    handleGetRegressedQueriesDetailedSummaryReportRequest: `DECLARE @recent_start_time DATETIMEOFFSET = '2023-06-17T11:34:56.0000000+00:00';
DECLARE @recent_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';
DECLARE @history_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @history_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';
DECLARE @min_exec_count BIGINT = 1;

WITH
wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.wait_category,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2) min_query_wait_time,
    ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2) max_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @history_end_time OR itvl.end_time < @history_start_time)

GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category
),
wait_stats_hist AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
WHERE
    NOT (ws.first_execution_time > @history_end_time OR ws.last_execution_time < @history_start_time)

GROUP BY p.query_id
),
other_hist AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_clr_time*rs.stdev_clr_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_clr_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_cpu_time*rs.stdev_cpu_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_cpu_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_dop*rs.stdev_dop*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_dop,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_duration,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_reads*rs.stdev_logical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_writes*rs.stdev_logical_io_writes*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_writes,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_log_bytes_used*rs.stdev_log_bytes_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.0009765625,2) stdev_log_bytes_used,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_query_max_used_memory*rs.stdev_query_max_used_memory*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_query_max_used_memory,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_physical_io_reads*rs.stdev_physical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_physical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_rowcount*rs.stdev_rowcount*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_rowcount,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_tempdb_space_used*rs.stdev_tempdb_space_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_tempdb_space_used,
    SUM(rs.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_runtime_stats rs
    JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
WHERE
    NOT (rs.first_execution_time > @history_end_time OR rs.last_execution_time < @history_start_time)

GROUP BY p.query_id
),
hist AS
(
SELECT
    other_hist.query_id,
    other_hist.stdev_clr_time stdev_clr_time,
    other_hist.stdev_cpu_time stdev_cpu_time,
    other_hist.stdev_dop stdev_dop,
    other_hist.stdev_duration stdev_duration,
    other_hist.stdev_logical_io_reads stdev_logical_io_reads,
    other_hist.stdev_logical_io_writes stdev_logical_io_writes,
    other_hist.stdev_log_bytes_used stdev_log_bytes_used,
    other_hist.stdev_query_max_used_memory stdev_query_max_used_memory,
    other_hist.stdev_physical_io_reads stdev_physical_io_reads,
    other_hist.stdev_rowcount stdev_rowcount,
    other_hist.stdev_tempdb_space_used stdev_tempdb_space_used,
    ISNULL(wait_stats_hist.stdev_query_wait_time, 0) stdev_query_wait_time,
    other_hist.count_executions,
    wait_stats_hist.count_executions wait_stats_count_executions,
    other_hist.num_plans
FROM other_hist
    LEFT JOIN wait_stats_hist ON wait_stats_hist.query_id = other_hist.query_id
),
wait_stats_recent AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) stdev_query_wait_time,
    MAX(ws.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
WHERE
    NOT (ws.first_execution_time > @recent_end_time OR ws.last_execution_time < @recent_start_time)

GROUP BY p.query_id
),
other_recent AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_clr_time*rs.stdev_clr_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_clr_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_cpu_time*rs.stdev_cpu_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_cpu_time,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_dop*rs.stdev_dop*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_dop,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_duration,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_reads*rs.stdev_logical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_logical_io_writes*rs.stdev_logical_io_writes*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_logical_io_writes,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_log_bytes_used*rs.stdev_log_bytes_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.0009765625,2) stdev_log_bytes_used,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_query_max_used_memory*rs.stdev_query_max_used_memory*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_query_max_used_memory,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_physical_io_reads*rs.stdev_physical_io_reads*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_physical_io_reads,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_rowcount*rs.stdev_rowcount*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*1,0) stdev_rowcount,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_tempdb_space_used*rs.stdev_tempdb_space_used*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2) stdev_tempdb_space_used,
    SUM(rs.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_runtime_stats rs
    JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
WHERE
    NOT (rs.first_execution_time > @recent_end_time OR rs.last_execution_time < @recent_start_time)

GROUP BY p.query_id
),
recent AS
(
SELECT
    other_recent.query_id,
    other_recent.stdev_clr_time stdev_clr_time,
    other_recent.stdev_cpu_time stdev_cpu_time,
    other_recent.stdev_dop stdev_dop,
    other_recent.stdev_duration stdev_duration,
    other_recent.stdev_logical_io_reads stdev_logical_io_reads,
    other_recent.stdev_logical_io_writes stdev_logical_io_writes,
    other_recent.stdev_log_bytes_used stdev_log_bytes_used,
    other_recent.stdev_query_max_used_memory stdev_query_max_used_memory,
    other_recent.stdev_physical_io_reads stdev_physical_io_reads,
    other_recent.stdev_rowcount stdev_rowcount,
    other_recent.stdev_tempdb_space_used stdev_tempdb_space_used,
    ISNULL(wait_stats_recent.stdev_query_wait_time, 0) stdev_query_wait_time,
    other_recent.count_executions,
    wait_stats_recent.count_executions wait_stats_count_executions,
    other_recent.num_plans
FROM other_recent
    LEFT JOIN wait_stats_recent ON wait_stats_recent.query_id = other_recent.query_id
)
SELECT 
    results.query_id query_id,
    results.object_id object_id,
    ISNULL(OBJECT_NAME(results.object_id),'') object_name,
    results.query_sql_text query_sql_text,
    results.clr_time_regr_perc_recent clr_time_regr_perc_recent,
    results.stdev_clr_time_recent stdev_clr_time_recent,
    results.stdev_clr_time_hist stdev_clr_time_hist,
    results.cpu_time_regr_perc_recent cpu_time_regr_perc_recent,
    results.stdev_cpu_time_recent stdev_cpu_time_recent,
    results.stdev_cpu_time_hist stdev_cpu_time_hist,
    results.dop_regr_perc_recent dop_regr_perc_recent,
    results.stdev_dop_recent stdev_dop_recent,
    results.stdev_dop_hist stdev_dop_hist,
    results.duration_regr_perc_recent duration_regr_perc_recent,
    results.stdev_duration_recent stdev_duration_recent,
    results.stdev_duration_hist stdev_duration_hist,
    results.logical_io_reads_regr_perc_recent logical_io_reads_regr_perc_recent,
    results.stdev_logical_io_reads_recent stdev_logical_io_reads_recent,
    results.stdev_logical_io_reads_hist stdev_logical_io_reads_hist,
    results.logical_io_writes_regr_perc_recent logical_io_writes_regr_perc_recent,
    results.stdev_logical_io_writes_recent stdev_logical_io_writes_recent,
    results.stdev_logical_io_writes_hist stdev_logical_io_writes_hist,
    results.log_bytes_used_regr_perc_recent log_bytes_used_regr_perc_recent,
    results.stdev_log_bytes_used_recent stdev_log_bytes_used_recent,
    results.stdev_log_bytes_used_hist stdev_log_bytes_used_hist,
    results.query_max_used_memory_regr_perc_recent query_max_used_memory_regr_perc_recent,
    results.stdev_query_max_used_memory_recent stdev_query_max_used_memory_recent,
    results.stdev_query_max_used_memory_hist stdev_query_max_used_memory_hist,
    results.physical_io_reads_regr_perc_recent physical_io_reads_regr_perc_recent,
    results.stdev_physical_io_reads_recent stdev_physical_io_reads_recent,
    results.stdev_physical_io_reads_hist stdev_physical_io_reads_hist,
    results.rowcount_regr_perc_recent rowcount_regr_perc_recent,
    results.stdev_rowcount_recent stdev_rowcount_recent,
    results.stdev_rowcount_hist stdev_rowcount_hist,
    results.tempdb_space_used_regr_perc_recent tempdb_space_used_regr_perc_recent,
    results.stdev_tempdb_space_used_recent stdev_tempdb_space_used_recent,
    results.stdev_tempdb_space_used_hist stdev_tempdb_space_used_hist,
    results.query_wait_time_regr_perc_recent query_wait_time_regr_perc_recent,
    results.stdev_query_wait_time_recent stdev_query_wait_time_recent,
    results.stdev_query_wait_time_hist stdev_query_wait_time_hist,
    ISNULL(results.count_executions_recent, 0) count_executions_recent,
    ISNULL(results.count_executions_hist, 0) count_executions_hist,
    queries.num_plans num_plans
FROM
(
SELECT
    hist.query_id query_id,
    q.object_id object_id,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, recent.stdev_clr_time-hist.stdev_clr_time)/NULLIF(hist.stdev_clr_time,0)*100.0, 2) clr_time_regr_perc_recent,
    ROUND(recent.stdev_clr_time, 2) stdev_clr_time_recent,
    ROUND(hist.stdev_clr_time, 2) stdev_clr_time_hist,
    ROUND(CONVERT(float, recent.stdev_cpu_time-hist.stdev_cpu_time)/NULLIF(hist.stdev_cpu_time,0)*100.0, 2) cpu_time_regr_perc_recent,
    ROUND(recent.stdev_cpu_time, 2) stdev_cpu_time_recent,
    ROUND(hist.stdev_cpu_time, 2) stdev_cpu_time_hist,
    ROUND(CONVERT(float, recent.stdev_dop-hist.stdev_dop)/NULLIF(hist.stdev_dop,0)*100.0, 2) dop_regr_perc_recent,
    ROUND(recent.stdev_dop, 2) stdev_dop_recent,
    ROUND(hist.stdev_dop, 2) stdev_dop_hist,
    ROUND(CONVERT(float, recent.stdev_duration-hist.stdev_duration)/NULLIF(hist.stdev_duration,0)*100.0, 2) duration_regr_perc_recent,
    ROUND(recent.stdev_duration, 2) stdev_duration_recent,
    ROUND(hist.stdev_duration, 2) stdev_duration_hist,
    ROUND(CONVERT(float, recent.stdev_logical_io_reads-hist.stdev_logical_io_reads)/NULLIF(hist.stdev_logical_io_reads,0)*100.0, 2) logical_io_reads_regr_perc_recent,
    ROUND(recent.stdev_logical_io_reads, 2) stdev_logical_io_reads_recent,
    ROUND(hist.stdev_logical_io_reads, 2) stdev_logical_io_reads_hist,
    ROUND(CONVERT(float, recent.stdev_logical_io_writes-hist.stdev_logical_io_writes)/NULLIF(hist.stdev_logical_io_writes,0)*100.0, 2) logical_io_writes_regr_perc_recent,
    ROUND(recent.stdev_logical_io_writes, 2) stdev_logical_io_writes_recent,
    ROUND(hist.stdev_logical_io_writes, 2) stdev_logical_io_writes_hist,
    ROUND(CONVERT(float, recent.stdev_log_bytes_used-hist.stdev_log_bytes_used)/NULLIF(hist.stdev_log_bytes_used,0)*100.0, 2) log_bytes_used_regr_perc_recent,
    ROUND(recent.stdev_log_bytes_used, 2) stdev_log_bytes_used_recent,
    ROUND(hist.stdev_log_bytes_used, 2) stdev_log_bytes_used_hist,
    ROUND(CONVERT(float, recent.stdev_query_max_used_memory-hist.stdev_query_max_used_memory)/NULLIF(hist.stdev_query_max_used_memory,0)*100.0, 2) query_max_used_memory_regr_perc_recent,
    ROUND(recent.stdev_query_max_used_memory, 2) stdev_query_max_used_memory_recent,
    ROUND(hist.stdev_query_max_used_memory, 2) stdev_query_max_used_memory_hist,
    ROUND(CONVERT(float, recent.stdev_physical_io_reads-hist.stdev_physical_io_reads)/NULLIF(hist.stdev_physical_io_reads,0)*100.0, 2) physical_io_reads_regr_perc_recent,
    ROUND(recent.stdev_physical_io_reads, 2) stdev_physical_io_reads_recent,
    ROUND(hist.stdev_physical_io_reads, 2) stdev_physical_io_reads_hist,
    ROUND(CONVERT(float, recent.stdev_rowcount-hist.stdev_rowcount)/NULLIF(hist.stdev_rowcount,0)*100.0, 2) rowcount_regr_perc_recent,
    ROUND(recent.stdev_rowcount, 2) stdev_rowcount_recent,
    ROUND(hist.stdev_rowcount, 2) stdev_rowcount_hist,
    ROUND(CONVERT(float, recent.stdev_tempdb_space_used-hist.stdev_tempdb_space_used)/NULLIF(hist.stdev_tempdb_space_used,0)*100.0, 2) tempdb_space_used_regr_perc_recent,
    ROUND(recent.stdev_tempdb_space_used, 2) stdev_tempdb_space_used_recent,
    ROUND(hist.stdev_tempdb_space_used, 2) stdev_tempdb_space_used_hist,
    ROUND(CONVERT(float, recent.stdev_query_wait_time-hist.stdev_query_wait_time)/NULLIF(hist.stdev_query_wait_time,0)*100.0, 2) query_wait_time_regr_perc_recent,
    ROUND(recent.stdev_query_wait_time, 2) stdev_query_wait_time_recent,
    ROUND(hist.stdev_query_wait_time, 2) stdev_query_wait_time_hist,
    recent.count_executions count_executions_recent,
    hist.count_executions count_executions_hist
FROM hist
    JOIN recent ON hist.query_id = recent.query_id
    JOIN sys.query_store_query q ON q.query_id = hist.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    recent.count_executions >= @min_exec_count
) AS results
JOIN
(
SELECT
    p.query_id query_id,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_plan p
GROUP BY p.query_id
HAVING COUNT(distinct p.plan_id) >= 1
) AS queries ON queries.query_id = results.query_id
OPTION (MERGE JOIN)`,
    handleGetPlanSummaryChartViewRequest: `DECLARE @query_id BIGINT = 97;
DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';

WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.execution_type,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2) min_query_wait_time,
    ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2) max_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
    FROM
    (
    SELECT *, LAST_VALUE(last_query_wait_time_ms) OVER (order by plan_id, runtime_stats_interval_id, execution_type, wait_category) last_query_wait_time
    FROM sys.query_store_wait_stats

    )
AS ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)
GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.execution_type, ws.wait_category
),
    bucketizer as 
    (
        SELECT
            ws.plan_id as plan_id,
            ws.execution_type as execution_type,
            MAX(ws.count_executions) count_executions,
            DATEADD(d, ((DATEDIFF(d, 0, ws.last_execution_time))),0 ) as bucket_start,
            DATEADD(d, (1 + (DATEDIFF(d, 0, ws.last_execution_time))), 0) as bucket_end,
            ROUND(CONVERT(float, SUM(ws.avg_query_wait_time*ws.count_executions))/NULLIF(SUM(ws.count_executions), 0)*1,2) as avg_query_wait_time,
            ROUND(CONVERT(float, MAX(ws.max_query_wait_time))*1,2) as max_query_wait_time,
            ROUND(CONVERT(float, MIN(ws.min_query_wait_time))*1,2) as min_query_wait_time,
            ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2) as stdev_query_wait_time,
            ISNULL(ROUND(CONVERT(float, (SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0))*SUM(ws.count_executions)) / NULLIF(SUM(ws.avg_query_wait_time*ws.count_executions), 0)),2), 0) as variation_query_wait_time,
            ROUND(CONVERT(float, SUM(ws.avg_query_wait_time*ws.count_executions))*1,2) as total_query_wait_time
        FROM
            wait_stats ws
            JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
        WHERE
            p.query_id = @query_id
        AND NOT (ws.first_execution_time > @interval_end_time OR ws.last_execution_time < @interval_start_time)

        GROUP BY
            ws.plan_id,
            ws.execution_type,
            DATEDIFF(d, 0, ws.last_execution_time)
    ),
    is_forced as
    (
        SELECT is_forced_plan, plan_id
          FROM sys.query_store_plan
    )
SELECT b.plan_id as plan_id,
    is_forced_plan,
    execution_type,
    count_executions,
    SWITCHOFFSET(bucket_start, DATEPART(tz, @interval_start_time)) AS bucket_start,
    SWITCHOFFSET(bucket_end, DATEPART(tz, @interval_start_time)) AS bucket_end,
    avg_query_wait_time,
    max_query_wait_time,
    min_query_wait_time,
    stdev_query_wait_time,
    variation_query_wait_time,
    total_query_wait_time
FROM bucketizer b
JOIN is_forced f ON f.plan_id = b.plan_id`,
    handleGetPlanSummaryGridViewRequest: `DECLARE @query_id BIGINT = 97;
DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';
DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';

WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.execution_type,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2) min_query_wait_time,
    ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2) max_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.last_query_wait_time))*1,2) last_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
    FROM
    (
    SELECT *, LAST_VALUE(last_query_wait_time_ms) OVER (order by plan_id, runtime_stats_interval_id, execution_type, wait_category) last_query_wait_time
    FROM sys.query_store_wait_stats

    )
AS ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)
GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.execution_type, ws.wait_category
),
    last_table AS
    (
        SELECT
            p.plan_id plan_id,
            first_value(ws.last_query_wait_time) OVER (PARTITION BY p.plan_id ORDER BY ws.last_execution_time DESC) last_value
        FROM
            wait_stats ws
        JOIN
            sys.query_store_plan p ON p.plan_id = ws.plan_id
        WHERE
            p.query_id = @query_id
    )
SELECT p.plan_id,
    MAX(CONVERT(int, p.is_forced_plan)) is_forced_plan,
    SUM(distinct ws.execution_type) execution_type,
    MAX(ws.count_executions) count_executions,
    ROUND(ROUND(CONVERT(float, MIN(ws.min_query_wait_time))*1,2), 2) min_query_wait_time,
    ROUND(ROUND(CONVERT(float, MAX(ws.max_query_wait_time))*1,2), 2) max_query_wait_time,
    ROUND(ROUND(CONVERT(float, SUM(ws.avg_query_wait_time*ws.count_executions))/NULLIF(SUM(ws.count_executions), 0)*1,2), 2) avg_query_wait_time,
    ROUND(ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0)))*1,2), 2) stdev_query_wait_time,
    ROUND(ISNULL(ROUND(CONVERT(float, (SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0))*SUM(ws.count_executions)) / NULLIF(SUM(ws.avg_query_wait_time*ws.count_executions), 0)),2), 0), 2) variation_query_wait_time,
    ROUND(max(l.last_value), 2) last_query_wait_time,
    ROUND(ROUND(CONVERT(float, SUM(ws.avg_query_wait_time*ws.count_executions))*1,2), 2) total_query_wait_time,
    SWITCHOFFSET(MIN(ws.first_execution_time), DATEPART(tz, @interval_start_time)) first_execution_time,
    SWITCHOFFSET(MAX(ws.last_execution_time), DATEPART(tz, @interval_start_time)) last_execution_time
FROM
    wait_stats ws
JOIN
    sys.query_store_plan p ON p.plan_id = ws.plan_id
JOIN
    last_table l ON p.plan_id = l.plan_id
WHERE p.query_id = @query_id
        AND NOT (ws.first_execution_time > @interval_end_time OR ws.last_execution_time < @interval_start_time)
GROUP BY p.plan_id, ws.execution_type
ORDER BY count_executions DESC`,
};
