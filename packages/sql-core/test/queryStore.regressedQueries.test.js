/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    getRegressedQueriesDetailedSummaryReportQuery,
    getRegressedQueriesSummaryReportQuery,
    regressedQueryDetailedSummary,
    regressedQuerySummary,
} = require("../dist/performance/index.js");
const baselines = require("../test-fixtures/queryStoreBaselines.js");
const csharp = require("../test-fixtures/queryStoreCSharpOutputs.js");
const {
    baselineSettings,
    dbOrderMetrics,
    harnessSettings,
    ids,
    mockAvailableMetrics,
    recentTestTimeInterval,
    sql2016Metrics,
    testTimeInterval,
    withDeclarations,
} = require("../test-fixtures/queryStoreTestSettings.js");

// QueryStoreTests.cs: the RegressedQueries test.
const baselineConfig = {
    ...baselineSettings,
    minExecutionCount: 1,
    timeIntervalHistory: testTimeInterval,
    timeIntervalRecent: recentTestTimeInterval,
};

const harnessConfig = {
    ...harnessSettings,
    minExecutionCount: 3,
    timeIntervalHistory: testTimeInterval,
    timeIntervalRecent: recentTestTimeInterval,
};

const replicaDeclaration = "DECLARE @replica_group_id BIGINT = 1;";

suite("Regressed Queries", () => {
    test("matches the SQL Tools Service baselines", () => {
        assert.equal(
            getRegressedQueriesSummaryReportQuery(baselineConfig),
            baselines.handleGetRegressedQueriesSummaryReportRequest,
        );
        assert.equal(
            getRegressedQueriesDetailedSummaryReportQuery(baselineConfig, mockAvailableMetrics),
            baselines.handleGetRegressedQueriesDetailedSummaryReportRequest,
        );
    });

    test("matches the C# output for runtime stats with a row limit", () => {
        const sql = getRegressedQueriesSummaryReportQuery({
            ...harnessConfig,
            selectedMetric: "duration",
            selectedStatistic: "avg",
        });
        assert.equal(sql, csharp.regressedSummaryDurationAvgTop);
        assert.deepEqual(
            sql.split("\n").filter((line) => line.startsWith("DECLARE")),
            [
                "DECLARE @recent_start_time DATETIMEOFFSET = '2023-06-17T11:34:56.0000000+00:00';",
                "DECLARE @recent_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';",
                "DECLARE @history_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';",
                "DECLARE @history_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';",
                "DECLARE @min_exec_count BIGINT = 3;",
                "DECLARE @results_row_count INT = 7;",
            ],
        );
    });

    test("declares the replica group, which the C# code leaves out", () => {
        assert.equal(
            getRegressedQueriesSummaryReportQuery({
                ...harnessConfig,
                selectedMetric: "waitTime",
                selectedStatistic: "total",
                isQdsRoAvailable: true,
            }),
            withDeclarations(csharp.regressedSummaryWaitTimeTotalTopReplica, replicaDeclaration),
        );
        assert.equal(
            getRegressedQueriesDetailedSummaryReportQuery(
                { ...harnessConfig, selectedStatistic: "max", isQdsRoAvailable: true },
                dbOrderMetrics,
            ),
            withDeclarations(csharp.regressedDetailedDbOrderMaxTopReplica, replicaDeclaration),
        );
    });

    test("matches the C# output for the detailed summary without wait stats", () => {
        assert.equal(
            getRegressedQueriesDetailedSummaryReportQuery(
                { ...harnessConfig, selectedStatistic: "total", returnAllQueries: true },
                sql2016Metrics,
            ),
            csharp.regressedDetailedSql2016TotalAll,
        );
    });

    test("removes only the first execution count like List.Remove, without changing the input", () => {
        const metrics = ["duration", "executionCount", "cpuTime", "executionCount", "duration"];
        const config = { ...harnessConfig, selectedStatistic: "avg" };
        assert.equal(
            getRegressedQueriesDetailedSummaryReportQuery(config, metrics),
            csharp.regressedDetailedDuplicatesNoWaitAvgTop,
        );
        assert.deepEqual(metrics, [
            "duration",
            "executionCount",
            "cpuTime",
            "executionCount",
            "duration",
        ]);
        assert.deepEqual(ids(regressedQueryDetailedSummary(metrics, config).columns).slice(4, 7), [
            "duration_regr_perc_recent",
            "avg_duration_recent",
            "avg_duration_hist",
        ]);
    });

    test("sorts in the generator function", () => {
        const config = { ...harnessConfig, selectedMetric: "cpuTime", selectedStatistic: "avg" };
        const { columns } = regressedQuerySummary(config);
        assert.equal(
            regressedQuerySummary(config, columns[4], false).sql,
            csharp.regressedSummaryCpuAvgSortedGenerator,
        );
        assert.match(
            regressedQuerySummary(config).sql,
            /WHERE cpu_time_regr_perc_recent > 0\nOPTION \(MERGE JOIN\)$/,
        );
    });

    test("returns the regression, recent, and history columns", () => {
        const { columns } = regressedQuerySummary({
            selectedMetric: "duration",
            selectedStatistic: "avg",
        });
        assert.deepEqual(ids(columns), [
            "query_id",
            "object_id",
            "object_name",
            "query_sql_text",
            "duration_regr_perc_recent",
            "avg_duration_recent",
            "avg_duration_hist",
            "count_executions_recent",
            "count_executions_hist",
            "num_plans",
        ]);
        assert.deepEqual(
            columns.slice(4, 7).map((column) => column.kind),
            ["statisticMetricRegression", "statisticMetricTime", "statisticMetricTime"],
        );
        assert.equal(
            regressedQuerySummary({ selectedMetric: "duration" }).columns[4].id,
            "additional_duration_workload",
        );
    });

    test("uses the C# defaults", () => {
        const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
        const sql = getRegressedQueriesSummaryReportQuery({}, now);
        assert.ok(
            sql.startsWith(
                "DECLARE @recent_start_time DATETIMEOFFSET = '2026-10-08T05:00:00.0000000+00:00';\n" +
                    "DECLARE @recent_end_time DATETIMEOFFSET = '2026-10-08T06:00:00.0000000+00:00';\n" +
                    "DECLARE @history_start_time DATETIMEOFFSET = '2026-10-01T06:00:00.0000000+00:00';\n" +
                    "DECLARE @history_end_time DATETIMEOFFSET = '2026-10-08T06:00:00.0000000+00:00';\n" +
                    "DECLARE @min_exec_count BIGINT = 1;\n" +
                    "DECLARE @results_row_count INT = 25;\n\nWITH \nhist AS\n",
            ),
        );
        assert.match(sql, /\nWHERE additional_duration_workload > 0\nOPTION \(MERGE JOIN\)$/);
    });

    test("rejects configurations that are not valid", () => {
        const invalid = [
            { minExecutionCount: "1 OR 1=1" },
            { minExecutionCount: 1.5 },
            { timeIntervalRecent: { start: new Date(Number.NaN), end: new Date() } },
            { timeIntervalHistory: { option: "forever" } },
            { selectedStatistic: "last" },
            { minNumberOfQueryPlans: "2; DROP TABLE t" },
        ];
        for (const config of invalid) {
            assert.throws(
                () => getRegressedQueriesSummaryReportQuery(config),
                RangeError,
                JSON.stringify(config),
            );
        }
        assert.throws(
            () => getRegressedQueriesDetailedSummaryReportQuery({}, ["duration", "bogus"]),
            RangeError,
        );
    });
});
