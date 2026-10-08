/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    getHighVariationQueriesDetailedSummaryReportQuery,
    getHighVariationQueriesSummaryReportQuery,
    highVariationDetailedSummary,
    highVariationSummary,
} = require("../dist/performance/index.js");
const baselines = require("../test-fixtures/queryStoreBaselines.js");
const csharp = require("../test-fixtures/queryStoreCSharpOutputs.js");
const {
    baselineSettings,
    dbOrderMetrics,
    harnessSettings,
    ids,
    mockAvailableMetrics,
    sql2016Metrics,
    testTimeInterval,
    withDeclarations,
} = require("../test-fixtures/queryStoreTestSettings.js");

// QueryStoreTests.cs: the HighVariationQueries test.
const baselineConfig = { ...baselineSettings, timeInterval: testTimeInterval };
const harnessConfig = { ...harnessSettings, timeInterval: testTimeInterval };
const replicaDeclaration = "DECLARE @replica_group_id BIGINT = 1;";

suite("High Variation", () => {
    test("matches the SQL Tools Service baselines", () => {
        assert.equal(
            getHighVariationQueriesSummaryReportQuery(baselineConfig, "query_id", true),
            baselines.handleGetHighVariationQueriesSummaryReportRequest,
        );
        assert.equal(
            getHighVariationQueriesDetailedSummaryReportQuery(
                baselineConfig,
                mockAvailableMetrics,
                "query_id",
                true,
            ),
            baselines.handleGetHighVariationQueriesDetailedSummaryReportRequest,
        );
    });

    test("leaves out the variation column for other statistics", () => {
        const config = { ...harnessConfig, selectedMetric: "cpuTime", selectedStatistic: "avg" };
        assert.equal(
            getHighVariationQueriesSummaryReportQuery(config),
            csharp.highVariationSummaryCpuAvgTop,
        );
        assert.deepEqual(ids(highVariationSummary(config).columns), [
            "query_id",
            "object_id",
            "object_name",
            "query_sql_text",
            "stdev_cpu_time",
            "avg_cpu_time",
            "count_executions",
            "num_plans",
        ]);
        assert.ok(
            ids(highVariationSummary({ selectedMetric: "duration" }).columns).includes(
                "variation_duration",
            ),
        );
    });

    test("declares the replica group, which the C# code leaves out", () => {
        assert.equal(
            getHighVariationQueriesSummaryReportQuery({
                ...harnessConfig,
                selectedMetric: "waitTime",
                selectedStatistic: "variation",
                returnAllQueries: true,
                isQdsRoAvailable: true,
            }),
            withDeclarations(
                csharp.highVariationSummaryWaitTimeVariationAllReplica,
                replicaDeclaration,
            ),
        );
        assert.equal(
            getHighVariationQueriesDetailedSummaryReportQuery(
                { ...harnessConfig, selectedStatistic: "stdev", isQdsRoAvailable: true },
                sql2016Metrics,
            ),
            withDeclarations(
                csharp.highVariationDetailedSql2016StdevTopReplica,
                replicaDeclaration,
            ),
        );
        assert.equal(
            getHighVariationQueriesDetailedSummaryReportQuery(
                { ...harnessConfig, selectedStatistic: "avg", isQdsRoAvailable: true },
                dbOrderMetrics,
            ),
            withDeclarations(csharp.highVariationDetailedDbOrderAvgTopReplica, replicaDeclaration),
        );
    });

    test("returns the detailed columns with wait time from the wait stats", () => {
        const { columns } = highVariationDetailedSummary(mockAvailableMetrics, baselineConfig);
        assert.equal(columns.length, 18);
        assert.deepEqual(ids(columns).slice(-3), [
            "stdev_query_wait_time",
            "count_executions",
            "num_plans",
        ]);
    });

    test("uses the C# defaults", () => {
        const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
        const sql = getHighVariationQueriesSummaryReportQuery({}, undefined, true, now);
        assert.ok(
            sql.startsWith(
                "DECLARE @interval_start_time DATETIMEOFFSET = '2026-10-08T05:00:00.0000000+00:00';\n" +
                    "DECLARE @interval_end_time DATETIMEOFFSET = '2026-10-08T06:00:00.0000000+00:00';\n" +
                    "DECLARE @results_row_count INT = 25;\n\nSELECT TOP (@results_row_count)\n",
            ),
        );
        assert.match(sql, / variation_duration,$/m);
        assert.match(
            sql,
            /HAVING COUNT\(distinct p\.plan_id\) >= 1 AND SUM\(rs\.count_executions\) > 1\nORDER BY query_id DESC$/,
        );
    });

    test("rejects configurations and sort columns that are not valid", () => {
        assert.throws(
            () => getHighVariationQueriesSummaryReportQuery({ selectedMetric: "bogus" }),
            RangeError,
        );
        assert.throws(
            () => getHighVariationQueriesSummaryReportQuery({}, "query_id; --"),
            RangeError,
        );
        assert.throws(
            () =>
                getHighVariationQueriesDetailedSummaryReportQuery(
                    { selectedStatistic: "last" },
                    sql2016Metrics,
                ),
            RangeError,
        );
    });
});
