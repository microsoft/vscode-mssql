/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    appendOrderBy,
    availableMetricsProbeQuery,
    calculateGoodSubInterval,
    dateFunctionIntervalString,
    executionCountColumnInfo,
    formatDateTimeOffset,
    getColumnIndex,
    getOrderByColumn,
    getRuntimeStatsSummary,
    getStatsViewAlias,
    getStatsViewName,
    getTSqlRepresentation,
    getTimeIntervalStart,
    getWaitCategoryById,
    getWaitStatsSummary,
    getWaitStatsTableExpression,
    mapAvailableMetrics,
    mapDbNamesToAvailableMetrics,
    metricConversionFactor,
    metricRoundOffPoints,
    prependSqlParameters,
    queryStoreMetrics,
    referencesSqlParameter,
    withUsedParameters,
    queryStoreParameters,
    replicaGroupIds,
    resolveQueryConfigurationBase,
    resolveTimeInterval,
    rowsToReturnString,
    simpleColumnInfo,
    statisticMetricColumnInfo,
    statisticMetricRegressionColumnInfo,
    statisticMetricTimeColumnInfo,
    updateColumnInfo,
} = require("../dist/performance/index.js");

// The expected formulas of QueryGeneratorUtilsTests.cs in SQL Tools Service.
const runtimeStatsTableName = "rs";
const totalCpuTime = "ROUND(CONVERT(float, SUM(rs.avg_cpu_time*rs.count_executions))*0.001,2)";
const avgCpuTime =
    "ROUND(CONVERT(float, SUM(rs.avg_cpu_time*rs.count_executions))/NULLIF(SUM(rs.count_executions), 0)*0.001,2)";
const minCpuTime = "ROUND(CONVERT(float, MIN(rs.min_cpu_time))*0.001,2)";
const maxCpuTime = "ROUND(CONVERT(float, MAX(rs.max_cpu_time))*0.001,2)";
const stdevCpuTime =
    "ROUND(CONVERT(float, SQRT( SUM(rs.stdev_cpu_time*rs.stdev_cpu_time*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2)";
const totalExecutionCount = "CONVERT(float, SUM(rs.count_executions))";
const totalLogicalReads =
    "ROUND(CONVERT(float, SUM(rs.avg_logical_io_reads*rs.count_executions))*8,2)";
const stdevMemoryConsumption =
    "ROUND(CONVERT(float, SQRT( SUM(rs.stdev_query_max_used_memory*rs.stdev_query_max_used_memory*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*8,2)";
const variationWaitTime =
    "ISNULL(ROUND(CONVERT(float, (SQRT( SUM(ws.stdev_query_wait_time*ws.stdev_query_wait_time*ws.count_executions)/NULLIF(SUM(ws.count_executions), 0))*SUM(ws.count_executions)) / NULLIF(SUM(ws.avg_query_wait_time*ws.count_executions), 0)),2), 0)";

suite("Query Store generator utils", () => {
    test("rejects the last statistic for runtime stats", () => {
        assert.throws(
            () => getRuntimeStatsSummary("last", "cpuTime", runtimeStatsTableName),
            RangeError,
        );
    });

    test("builds the runtime stats formula for each statistic of CPU time", () => {
        const summary = (statistic) =>
            getRuntimeStatsSummary(statistic, "cpuTime", runtimeStatsTableName);
        assert.equal(summary("total"), totalCpuTime);
        assert.equal(summary("avg"), avgCpuTime);
        assert.equal(summary("min"), minCpuTime);
        assert.equal(summary("max"), maxCpuTime);
        assert.equal(summary("stdev"), stdevCpuTime);
    });

    test("sums the execution count for any statistic", () => {
        assert.equal(
            getRuntimeStatsSummary("total", "executionCount", runtimeStatsTableName),
            totalExecutionCount,
        );
        assert.equal(
            getRuntimeStatsSummary("last", "executionCount", runtimeStatsTableName),
            totalExecutionCount,
        );
    });

    test("converts pages to KB", () => {
        assert.equal(
            getRuntimeStatsSummary("total", "logicalReads", runtimeStatsTableName),
            totalLogicalReads,
        );
        assert.equal(
            getRuntimeStatsSummary("stdev", "memoryConsumption", runtimeStatsTableName),
            stdevMemoryConsumption,
        );
    });

    test("does not convert or round the variation", () => {
        assert.equal(getRuntimeStatsSummary("variation", "waitTime", "ws"), variationWaitTime);
    });

    test("writes each conversion factor and rounding like the C# code", () => {
        const factors = Object.fromEntries(
            queryStoreMetrics.map((metric) => [
                metric,
                `${metricConversionFactor(metric)},${metricRoundOffPoints(metric)}`,
            ]),
        );
        assert.deepEqual(factors, {
            cpuTime: "0.001,2",
            duration: "0.001,2",
            logicalWrites: "8,2",
            logicalReads: "8,2",
            memoryConsumption: "8,2",
            physicalReads: "8,2",
            executionCount: "1,0",
            clrTime: "0.001,2",
            dop: "1,0",
            rowCount: "1,0",
            logMemoryUsed: "0.0009765625,2",
            tempDbMemoryUsed: "8,2",
            waitTime: "1,2",
        });
        assert.equal(
            getRuntimeStatsSummary("min", "logMemoryUsed", "rs"),
            "ROUND(CONVERT(float, MIN(rs.min_log_bytes_used))*0.0009765625,2)",
        );
        assert.equal(
            getRuntimeStatsSummary("max", "rowCount", "rs"),
            "ROUND(CONVERT(float, MAX(rs.max_rowcount))*1,0)",
        );
    });

    test("builds the wait stats formula for each statistic", () => {
        const summary = (statistic) => getWaitStatsSummary(statistic, "ws");
        assert.equal(
            summary("avg"),
            "ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2)",
        );
        assert.equal(summary("min"), "ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2)");
        assert.equal(summary("max"), "ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2)");
        assert.equal(
            summary("stdev"),
            "ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2)",
        );
        assert.equal(summary("last"), "ROUND(CONVERT(float, MIN(ws.last_query_wait_time))*1,2)");
        assert.equal(
            summary("total"),
            "ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2)",
        );
        assert.throws(() => summary("variation"), RangeError);
    });

    test("rejects unknown metrics, statistics, and aliases", () => {
        assert.throws(() => getRuntimeStatsSummary("avg", "bogus", "rs"), RangeError);
        assert.throws(() => getRuntimeStatsSummary("median", "duration", "rs"), RangeError);
        assert.throws(() => getRuntimeStatsSummary("avg", "duration", "rs; DROP"), RangeError);
        assert.throws(() => getWaitStatsSummary("avg", "ws)"), RangeError);
    });

    test("uses the wait stats view only for wait time", () => {
        assert.equal(getStatsViewName("waitTime"), "wait_stats");
        assert.equal(getStatsViewAlias("waitTime"), "ws");
        assert.equal(getStatsViewName("duration"), "sys.query_store_runtime_stats");
        assert.equal(getStatsViewAlias("duration"), "rs");
    });

    test("limits rows with the row count parameter", () => {
        assert.equal(rowsToReturnString(false), "TOP (@results_row_count)");
        assert.equal(rowsToReturnString(true), "");
        assert.equal(queryStoreParameters.waitCategoryId, "@wait_category");
    });
});

suite("Query Store columns", () => {
    test("labels the statistic and metric columns", () => {
        assert.deepEqual(statisticMetricColumnInfo("stdev", "logMemoryUsed"), {
            kind: "statisticMetric",
            id: "stdev_log_bytes_used",
            statistic: "stdev",
            metric: "logMemoryUsed",
            bindRuntimeData: false,
        });
        assert.equal(
            statisticMetricTimeColumnInfo("avg", "duration", "history").id,
            "avg_duration_hist",
        );
        assert.equal(
            statisticMetricTimeColumnInfo("avg", "duration", "recent").id,
            "avg_duration_recent",
        );
        assert.equal(
            statisticMetricRegressionColumnInfo("total", "cpuTime").id,
            "additional_cpu_time_workload",
        );
        assert.equal(
            statisticMetricRegressionColumnInfo("avg", "cpuTime").id,
            "cpu_time_regr_perc_recent",
        );
        assert.equal(executionCountColumnInfo().id, "count_executions");
        assert.equal(executionCountColumnInfo("recent").id, "count_executions_recent");
        assert.equal(executionCountColumnInfo("history").id, "count_executions_hist");
    });

    test("keeps a stable kind when labels are the same", () => {
        assert.equal(simpleColumnInfo("lastExecTime").id, "last_execution_time");
        assert.equal(simpleColumnInfo("lastQueryExecTime").id, "last_execution_time");
        assert.equal(simpleColumnInfo("forcedPlanId").id, "plan_id");
        assert.equal(simpleColumnInfo("planForced").id, "is_forced_plan");
        assert.throws(() => simpleColumnInfo("statisticMetric"), RangeError);
    });

    test("updates a sort column for a new selection", () => {
        assert.deepEqual(
            updateColumnInfo(
                statisticMetricColumnInfo("avg", "duration"),
                "executionCount",
                "total",
            ),
            executionCountColumnInfo(),
        );
        assert.deepEqual(
            updateColumnInfo(simpleColumnInfo("numPlans"), "cpuTime", "max"),
            statisticMetricColumnInfo("max", "cpuTime"),
        );
        assert.deepEqual(
            updateColumnInfo(
                statisticMetricTimeColumnInfo("avg", "duration", "recent"),
                "dop",
                "min",
            ),
            statisticMetricTimeColumnInfo("min", "dop", "recent"),
        );
        assert.deepEqual(
            updateColumnInfo(simpleColumnInfo("queryId"), "dop", "min"),
            simpleColumnInfo("queryId"),
        );
    });

    test("finds the sort column by label", () => {
        const columns = [simpleColumnInfo("queryId"), statisticMetricColumnInfo("avg", "duration")];
        assert.equal(getOrderByColumn(undefined, columns), columns[0]);
        assert.equal(getOrderByColumn("avg_duration", columns), columns[1]);
        assert.throws(() => getOrderByColumn("query_id; DROP TABLE t", columns), RangeError);
        assert.throws(() => getOrderByColumn(undefined, []), RangeError);
        assert.equal(getColumnIndex(columns, "statisticMetric"), 1);
        assert.equal(getColumnIndex(columns, "numPlans"), -1);
    });

    test("appends ORDER BY like the C# code", () => {
        const column = statisticMetricColumnInfo("avg", "duration");
        assert.equal(appendOrderBy("SELECT 1", column), "SELECT 1\nORDER BY avg_duration DESC");
        assert.equal(
            appendOrderBy("SELECT 1", column, { descending: false, subqueryAlias: "A" }),
            "SELECT 1\nORDER BY A.avg_duration ASC",
        );
        assert.equal(appendOrderBy("SELECT 1", undefined), "SELECT 1");
    });
});

suite("Query Store parameters", () => {
    test("writes each type like GetTSqlRepresentation", () => {
        assert.equal(getTSqlRepresentation({ type: "int", value: 50 }), "INT = 50");
        assert.equal(
            getTSqlRepresentation({ type: "bigint", value: "9223372036854775807" }),
            "BIGINT = 9223372036854775807",
        );
        assert.equal(getTSqlRepresentation({ type: "bigint", value: 97n }), "BIGINT = 97");
        assert.equal(
            getTSqlRepresentation({ type: "nvarchar", value: "it's a 'test'" }),
            "NVARCHAR(max) = N'it''s a ''test'''",
        );
        assert.equal(
            getTSqlRepresentation({
                type: "datetimeoffset",
                value: new Date(Date.UTC(2023, 5, 10, 12, 34, 56, 789)),
            }),
            "DATETIMEOFFSET = '2023-06-10T12:34:56.7890000+00:00'",
        );
    });

    test("rejects values that do not fit the type", () => {
        const invalid = [
            { type: "int", value: 1.5 },
            { type: "int", value: Number.NaN },
            { type: "int", value: Infinity },
            { type: "int", value: 2147483648 },
            { type: "int", value: "25" },
            { type: "bigint", value: "1; DROP TABLE t" },
            { type: "bigint", value: "9223372036854775808" },
            { type: "bigint", value: 2 ** 60 },
            { type: "nvarchar", value: "a\0b" },
            { type: "nvarchar", value: 5 },
            { type: "datetimeoffset", value: new Date(Number.NaN) },
            { type: "datetimeoffset", value: "2023-06-10" },
            { type: "datetimeoffset", value: new Date(Date.UTC(10000, 0, 1)) },
            { type: "xml", value: "<a/>" },
        ];
        for (const parameter of invalid) {
            assert.throws(
                () => getTSqlRepresentation(parameter),
                RangeError,
                JSON.stringify(parameter),
            );
        }
    });

    test("prepends the declarations in order", () => {
        const sql = prependSqlParameters("SELECT @query_id, @name;", [
            { name: "@query_id", type: "bigint", value: 97 },
            { name: "@name", type: "nvarchar", value: "O'Brien" },
        ]);
        assert.equal(
            sql,
            "DECLARE @query_id BIGINT = 97;\nDECLARE @name NVARCHAR(max) = N'O''Brien';\n\nSELECT @query_id, @name;",
        );
        assert.equal(prependSqlParameters("  SELECT 1  ", []), "SELECT 1");
    });

    test("rejects parameter names that are not variables, and duplicates", () => {
        assert.throws(
            () => prependSqlParameters("", [{ name: "@a = 1; --", type: "int", value: 1 }]),
            RangeError,
        );
        assert.throws(
            () => prependSqlParameters("", [{ name: "query_id", type: "int", value: 1 }]),
            RangeError,
        );
        assert.throws(
            () =>
                prependSqlParameters("", [
                    { name: "@a", type: "int", value: 1 },
                    { name: "@A", type: "int", value: 2 },
                ]),
            RangeError,
        );
    });

    test("formats dates in the C# round-trip format in UTC", () => {
        assert.equal(
            formatDateTimeOffset(new Date("2023-06-10T12:34:56Z")),
            "2023-06-10T12:34:56.0000000+00:00",
        );
        assert.equal(
            formatDateTimeOffset(resolveTimeInterval({ option: "allTime" }).start),
            "0001-01-01T00:00:00.0000000+00:00",
        );
    });
});

suite("Query Store configuration", () => {
    test("applies the C# defaults", () => {
        assert.deepEqual(resolveQueryConfigurationBase({}), {
            selectedMetric: "duration",
            selectedStatistic: "avg",
            topQueriesReturned: 25,
            returnAllQueries: false,
            minNumberOfQueryPlans: 1,
            replicaGroupId: String(replicaGroupIds.primary),
            isQdsRoAvailable: false,
            displayTimeKind: "utc",
        });
        assert.equal(
            resolveQueryConfigurationBase({}, { selectedStatistic: "total" }).selectedStatistic,
            "total",
        );
    });

    test("declares a variable only when the SQL uses it and the list does not have it", () => {
        const replica = { name: "@replica_group_id", type: "bigint", value: 2 };
        const start = { name: "@interval_start_time", type: "datetimeoffset", value: new Date(0) };
        assert.deepEqual(withUsedParameters("SELECT 1", [], [replica]), []);
        assert.deepEqual(withUsedParameters("WHERE x = @Replica_Group_Id", [], [replica]), [
            replica,
        ]);
        assert.deepEqual(withUsedParameters("WHERE x = @replica_group_ids", [], [replica]), []);
        assert.deepEqual(
            withUsedParameters(
                "WHERE @interval_start_time < y",
                [start],
                [{ ...start, value: new Date() }],
            ),
            [start],
        );
        assert.equal(
            referencesSqlParameter("DATEPART(tz, @interval_start_time)", "@interval_start_time"),
            true,
        );
        assert.throws(() => referencesSqlParameter("", "interval"), RangeError);
    });

    test("rejects values that are not valid", () => {
        const invalid = [
            { selectedMetric: "bogus" },
            { selectedStatistic: "median" },
            { topQueriesReturned: 2.5 },
            { topQueriesReturned: Number.NaN },
            { minNumberOfQueryPlans: "1) OR (1=1" },
            { replicaGroupId: "1 OR 1=1" },
            { returnAllQueries: "yes" },
            { isQdsRoAvailable: 1 },
        ];
        for (const config of invalid) {
            assert.throws(
                () => resolveQueryConfigurationBase(config),
                RangeError,
                JSON.stringify(config),
            );
        }
    });
});

suite("Query Store time intervals", () => {
    const now = new Date(Date.UTC(2024, 2, 31, 23, 59, 59, 999));

    test("ends a relative window now", () => {
        const interval = resolveTimeInterval({ option: "lastHour" }, now);
        assert.equal(interval.end.getTime(), now.getTime());
        assert.equal(interval.start.toISOString(), "2024-03-31T22:59:59.999Z");
        assert.equal(
            getTimeIntervalStart(now, "last2Weeks").toISOString(),
            "2024-03-17T23:59:59.999Z",
        );
    });

    test("clamps the day like DateTime.AddMonths", () => {
        assert.equal(
            getTimeIntervalStart(now, "lastMonth").toISOString(),
            "2024-02-29T23:59:59.999Z",
        );
        assert.equal(
            getTimeIntervalStart(now, "last6Months").toISOString(),
            "2023-09-30T23:59:59.999Z",
        );
        const leapDay = new Date(Date.UTC(2024, 1, 29, 1, 2, 3));
        assert.equal(
            getTimeIntervalStart(leapDay, "lastYear").toISOString(),
            "2023-02-28T01:02:03.000Z",
        );
    });

    test("keeps a custom window and rejects invalid dates", () => {
        const start = new Date(Date.UTC(2023, 5, 10));
        const end = new Date(Date.UTC(2023, 5, 17));
        const interval = resolveTimeInterval({ start, end });
        assert.equal(interval.start.getTime(), start.getTime());
        assert.equal(interval.end.getTime(), end.getTime());
        assert.throws(() => resolveTimeInterval({ start: new Date("x"), end }), RangeError);
        assert.throws(() => resolveTimeInterval({ start }), RangeError);
        assert.throws(() => resolveTimeInterval({ option: "custom" }, now), RangeError);
    });

    test("picks bucket sizes like CalculateGoodSubInterval", () => {
        const minute = 60 * 1000;
        assert.equal(calculateGoodSubInterval(60 * minute), "minute");
        assert.equal(calculateGoodSubInterval(61 * minute), "hour");
        assert.equal(calculateGoodSubInterval(48 * 60 * minute), "hour");
        assert.equal(calculateGoodSubInterval(31 * 24 * 60 * minute), "day");
        assert.equal(calculateGoodSubInterval(300 * 24 * 60 * minute), "week");
        assert.equal(calculateGoodSubInterval(301 * 24 * 60 * minute), "month");
        assert.equal(dateFunctionIntervalString("minute"), "mi");
        assert.equal(dateFunctionIntervalString("week"), "ww");
        assert.equal(dateFunctionIntervalString("automatic"), "d");
    });
});

suite("Query Store metadata", () => {
    test("maps the probe result to available metrics in column order", () => {
        assert.match(
            availableMetricsProbeQuery,
            /select top\(1\) \* from sys\.query_store_runtime_stats;/,
        );
        const metrics = mapAvailableMetrics([
            {
                columns: [
                    "runtime_stats_id",
                    "plan_id",
                    "count_executions",
                    "avg_duration",
                    "avg_cpu_time",
                    "avg_logical_io_reads",
                    "avg_dop",
                    "avg_log_bytes_used",
                    "replica_group_id",
                ],
                rows: [],
            },
            { columns: ["result"], rows: [[true]] },
        ]);
        assert.deepEqual(metrics, [
            "executionCount",
            "duration",
            "cpuTime",
            "logicalReads",
            "dop",
            "logMemoryUsed",
            "waitTime",
        ]);
    });

    test("leaves out wait time when the wait stats view does not exist", () => {
        const metrics = mapAvailableMetrics([
            { columns: ["count_executions", "avg_duration"], rows: [] },
            { columns: ["result"], rows: [[0]] },
        ]);
        assert.deepEqual(metrics, ["executionCount", "duration"]);
    });

    test("ignores duplicates and unknown names, and rejects an empty list", () => {
        assert.deepEqual(
            mapDbNamesToAvailableMetrics([
                "avg_duration",
                "avg_duration",
                "unknown",
                "wait_stats_id",
            ]),
            ["duration", "waitTime"],
        );
        assert.throws(() => mapDbNamesToAvailableMetrics([]), Error);
        assert.throws(() => mapAvailableMetrics([]), Error);
    });

    test("names wait categories like wait_category_desc", () => {
        assert.deepEqual(getWaitCategoryById(14), {
            category: "tranLogIo",
            id: 14,
            name: "Tran Log IO",
        });
        assert.equal(getWaitCategoryById(99), undefined);
    });
});

suite("Query Store wait stats table expression", () => {
    test("adds the replica group column, filter, and grouping", () => {
        const sql = getWaitStatsTableExpression("wait_stats", {
            statisticList: ["avg"],
            includeReplicaGroupId: true,
            addWithClause: true,
            addSeparator: true,
        });
        assert.equal(
            sql,
            `WITH wait_stats AS
(
SELECT
    ws.plan_id plan_id,
    ws.wait_category,
    ws.replica_group_id,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)
    AND ws.replica_group_id = @replica_group_id
GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category, ws.replica_group_id
),`,
        );
    });

    test("filters the inner query when it includes the last wait time", () => {
        const sql = getWaitStatsTableExpression("wait_stats", {
            statisticList: ["last"],
            includeReplicaGroupId: true,
            includeQueryExecutionLastWaitTime: true,
            endTime: "@history_end_time",
            startTime: "@history_start_time",
        });
        assert.match(
            sql,
            /^wait_stats AS\n\(\nSELECT\n {4}ws\.plan_id plan_id,\n {4}ws\.execution_type,/,
        );
        assert.match(sql, /\n {4}WHERE replica_group_id = @replica_group_id\n {4}\)\nAS ws\n/);
        assert.match(
            sql,
            /itvl\.start_time > @history_end_time OR itvl\.end_time < @history_start_time/,
        );
        assert.match(sql, /ws\.execution_type, ws\.wait_category, ws\.replica_group_id\n\)$/);
        assert.throws(
            () =>
                getWaitStatsTableExpression("wait_stats", {
                    includeReplicaGroupId: false,
                    endTime: "1",
                }),
            RangeError,
        );
    });
});
