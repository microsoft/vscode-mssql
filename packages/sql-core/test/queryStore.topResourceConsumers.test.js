/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    getTopResourceConsumersDetailedSummaryReportQuery,
    getTopResourceConsumersSummaryReportQuery,
    topResourceConsumersDetailedSummary,
    topResourceConsumersSummary,
} = require("../dist/performance/index.js");
const baselines = require("../test-fixtures/queryStoreBaselines.js");
const csharpOutputs = require("../test-fixtures/queryStoreCSharpOutputs.js");

// QueryStoreTests.cs: TestWindowStart = 6/10/2023 12:34:56 PM +0:00, TestWindowEnd = start + 7 days.
const testWindowStart = new Date(Date.UTC(2023, 5, 10, 12, 34, 56));
const testWindowEnd = new Date(testWindowStart.getTime() + 7 * 24 * 60 * 60 * 1000);
const testTimeInterval = { start: testWindowStart, end: testWindowEnd };

// QueryStoreTests.cs: the configuration of the TopResourceConsumers test.
const baselineConfig = {
    returnAllQueries: true,
    selectedMetric: "waitTime",
    selectedStatistic: "stdev",
    minNumberOfQueryPlans: 1,
    topQueriesReturned: 50,
    timeInterval: testTimeInterval,
};

// QueryStoreTests.cs: GetMockMetricFetcher.
const mockAvailableMetrics = [
    "clrTime",
    "cpuTime",
    "dop",
    "duration",
    "executionCount",
    "logicalReads",
    "logicalWrites",
    "logMemoryUsed",
    "memoryConsumption",
    "physicalReads",
    "rowCount",
    "tempDbMemoryUsed",
    "waitTime",
];

const sql2016Metrics = [
    "executionCount",
    "duration",
    "cpuTime",
    "logicalReads",
    "logicalWrites",
    "physicalReads",
    "clrTime",
    "dop",
    "memoryConsumption",
    "rowCount",
];

const dbOrderMetrics = [...sql2016Metrics, "logMemoryUsed", "tempDbMemoryUsed", "waitTime"];

// The settings of the queries in test-fixtures/queryStoreCSharpOutputs.js.
const harnessConfig = {
    topQueriesReturned: 7,
    minNumberOfQueryPlans: 2,
    timeInterval: testTimeInterval,
};

/** Normalizes only line endings and trailing whitespace on each line. */
function normalize(sql) {
    return sql
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n");
}

/** Adds the declaration that this port adds and the C# code leaves out. */
function withReplicaGroupDeclaration(sql) {
    return sql.replace("\n\n", "\nDECLARE @replica_group_id BIGINT = 1;\n\n");
}

const ids = (columns) => columns.map((column) => column.id);

suite("Top Resource Consumers", () => {
    test("matches the SQL Tools Service baseline for the summary", () => {
        const sql = getTopResourceConsumersSummaryReportQuery(baselineConfig, "query_id", true);
        assert.equal(sql, baselines.handleGetTopResourceConsumersSummaryReportRequest);
        assert.equal(
            normalize(sql),
            normalize(baselines.handleGetTopResourceConsumersSummaryReportRequest),
        );
    });

    test("matches the SQL Tools Service baseline for the detailed summary", () => {
        const sql = getTopResourceConsumersDetailedSummaryReportQuery(
            baselineConfig,
            mockAvailableMetrics,
            "query_id",
            true,
        );
        assert.equal(sql, baselines.handleGetTopResourceConsumersDetailedSummaryReportRequest);
    });

    test("matches the C# output with a row limit", () => {
        const sql = getTopResourceConsumersSummaryReportQuery({
            ...harnessConfig,
            selectedMetric: "duration",
            selectedStatistic: "avg",
        });
        assert.equal(sql, csharpOutputs.summaryDurationAvgTop);
        assert.match(sql, /^DECLARE @results_row_count INT = 7;$/m);
        assert.match(sql, /^SELECT TOP \(@results_row_count\)$/m);
    });

    test("matches the C# output for execution count, which has no statistic column", () => {
        const config = {
            ...harnessConfig,
            selectedMetric: "executionCount",
            selectedStatistic: "total",
            returnAllQueries: true,
        };
        assert.equal(
            getTopResourceConsumersSummaryReportQuery(config),
            csharpOutputs.summaryExecutionCountAll,
        );
        assert.deepEqual(ids(topResourceConsumersSummary(config).columns), [
            "query_id",
            "object_id",
            "object_name",
            "query_sql_text",
            "count_executions",
            "num_plans",
        ]);
    });

    test("matches the C# output when sorted by another column in ascending order", () => {
        const sql = getTopResourceConsumersSummaryReportQuery(
            { selectedMetric: "cpuTime", selectedStatistic: "max", timeInterval: testTimeInterval },
            "max_cpu_time",
            false,
        );
        assert.equal(sql, csharpOutputs.summaryCpuMaxOrderAscending);
    });

    test("matches the C# output for the detailed summary with every metric", () => {
        const sql = getTopResourceConsumersDetailedSummaryReportQuery(
            { ...harnessConfig, selectedStatistic: "total" },
            dbOrderMetrics,
        );
        assert.equal(sql, csharpOutputs.detailedDbOrderTotalTop);
    });

    test("declares the replica group, which the C# code leaves out", () => {
        const summary = getTopResourceConsumersSummaryReportQuery({
            ...harnessConfig,
            selectedMetric: "waitTime",
            selectedStatistic: "total",
            isQdsRoAvailable: true,
        });
        assert.equal(
            summary,
            withReplicaGroupDeclaration(csharpOutputs.summaryWaitTimeTotalTopReplica),
        );

        const detailed = getTopResourceConsumersDetailedSummaryReportQuery(
            { ...harnessConfig, selectedStatistic: "avg", isQdsRoAvailable: true },
            sql2016Metrics,
        );
        assert.equal(
            detailed,
            withReplicaGroupDeclaration(csharpOutputs.detailedSql2016AvgTopReplica),
        );

        const secondary = getTopResourceConsumersSummaryReportQuery({
            ...harnessConfig,
            isQdsRoAvailable: true,
            replicaGroupId: 2,
        });
        assert.match(secondary, /^DECLARE @replica_group_id BIGINT = 2;$/m);
    });

    test("returns the columns in result set order", () => {
        const { columns } = topResourceConsumersSummary({
            selectedMetric: "waitTime",
            selectedStatistic: "total",
        });
        assert.deepEqual(ids(columns), [
            "query_id",
            "object_id",
            "object_name",
            "query_sql_text",
            "total_query_wait_time",
            "count_executions",
            "num_plans",
        ]);
        assert.equal(columns[4].kind, "statisticMetric");
        assert.equal(columns[4].bindRuntimeData, true);

        const detailed = topResourceConsumersDetailedSummary(mockAvailableMetrics, baselineConfig);
        assert.deepEqual(ids(detailed.columns).slice(4), [
            "stdev_clr_time",
            "stdev_cpu_time",
            "stdev_dop",
            "stdev_duration",
            "stdev_logical_io_reads",
            "stdev_logical_io_writes",
            "stdev_log_bytes_used",
            "stdev_query_max_used_memory",
            "stdev_physical_io_reads",
            "stdev_rowcount",
            "stdev_tempdb_space_used",
            "stdev_query_wait_time",
            "count_executions",
            "num_plans",
        ]);
    });

    test("leaves out ORDER BY and declarations in the generator functions", () => {
        const { sql } = topResourceConsumersSummary(baselineConfig);
        assert.doesNotMatch(sql, /ORDER BY|DECLARE/);
        assert.match(sql, /^WITH wait_stats AS\n/);
        assert.match(sql, /HAVING COUNT\(distinct p\.plan_id\) >= 1$/);
    });

    test("uses the C# configuration defaults", () => {
        const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
        const sql = getTopResourceConsumersSummaryReportQuery({}, undefined, true, now);
        assert.ok(
            sql.startsWith(
                "DECLARE @interval_start_time DATETIMEOFFSET = '2026-10-08T05:00:00.0000000+00:00';\n" +
                    "DECLARE @interval_end_time DATETIMEOFFSET = '2026-10-08T06:00:00.0000000+00:00';\n" +
                    "DECLARE @results_row_count INT = 25;\n\nSELECT TOP (@results_row_count)\n",
            ),
        );
        assert.match(sql, / total_duration,$/m);
        assert.match(sql, /HAVING COUNT\(distinct p\.plan_id\) >= 1\nORDER BY query_id DESC$/);
    });

    test("resolves a relative time interval at the given time", () => {
        const now = new Date(Date.UTC(2024, 2, 31, 12, 0, 0));
        const sql = getTopResourceConsumersDetailedSummaryReportQuery(
            { timeInterval: { option: "lastMonth" } },
            sql2016Metrics,
            undefined,
            true,
            now,
        );
        assert.match(
            sql,
            /^DECLARE @interval_start_time DATETIMEOFFSET = '2024-02-29T12:00:00\.0000000\+00:00';$/m,
        );
    });

    test("rejects configurations that are not valid", () => {
        const invalid = [
            { ...baselineConfig, selectedMetric: "bogus" },
            { ...baselineConfig, selectedStatistic: "last" },
            { ...baselineConfig, minNumberOfQueryPlans: 1.5 },
            { ...baselineConfig, minNumberOfQueryPlans: "1 OR 1=1" },
            { ...baselineConfig, returnAllQueries: false, topQueriesReturned: Infinity },
            {
                ...baselineConfig,
                timeInterval: { start: new Date(Number.NaN), end: testWindowEnd },
            },
            { ...baselineConfig, timeInterval: { option: "lastCentury" } },
        ];
        for (const config of invalid) {
            assert.throws(
                () => getTopResourceConsumersSummaryReportQuery(config),
                RangeError,
                JSON.stringify(config),
            );
        }
        assert.throws(
            () => getTopResourceConsumersSummaryReportQuery(baselineConfig, "query_id DESC; --"),
            RangeError,
        );
        assert.throws(
            () => getTopResourceConsumersDetailedSummaryReportQuery(baselineConfig, ["bogus"]),
            RangeError,
        );
    });
});
