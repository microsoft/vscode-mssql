/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    getOverallResourceConsumptionReportQuery,
    overallResourceConsumption,
} = require("../dist/performance/index.js");
const baselines = require("../test-fixtures/queryStoreBaselines.js");
const csharp = require("../test-fixtures/queryStoreCSharpOutputs.js");
const {
    addMinutes,
    baselineSettings,
    dbOrderMetrics,
    ids,
    mockAvailableMetrics,
    sql2016Metrics,
    testTimeInterval,
    testWindowStart,
    withDeclarations,
} = require("../test-fixtures/queryStoreTestSettings.js");

suite("Overall Resource Consumption", () => {
    test("matches the SQL Tools Service baseline", () => {
        // QueryStoreTests.cs: the OverallResourceConsumption test.
        const sql = getOverallResourceConsumptionReportQuery(
            {
                ...baselineSettings,
                specifiedTimeInterval: testTimeInterval,
                selectedBucketInterval: "hour",
            },
            mockAvailableMetrics,
        );
        assert.equal(sql, baselines.handleGetOverallResourceConsumptionReportRequest);
    });

    test("matches the C# output for other buckets and metrics", () => {
        assert.equal(
            getOverallResourceConsumptionReportQuery(
                { specifiedTimeInterval: testTimeInterval, selectedBucketInterval: "month" },
                sql2016Metrics,
            ),
            csharp.overallSql2016Month,
        );
        assert.equal(
            getOverallResourceConsumptionReportQuery(
                {
                    specifiedTimeInterval: testTimeInterval,
                    selectedBucketInterval: "day",
                    isQdsRoAvailable: true,
                },
                dbOrderMetrics,
            ),
            withDeclarations(
                csharp.overallDbOrderDayReplica,
                "DECLARE @replica_group_id BIGINT = 1;",
            ),
        );
    });

    test("picks the bucket from the length of the window", () => {
        assert.equal(
            getOverallResourceConsumptionReportQuery(
                {
                    specifiedTimeInterval: {
                        start: testWindowStart,
                        end: addMinutes(testWindowStart, 30),
                    },
                },
                mockAvailableMetrics,
            ),
            csharp.overallAutomatic30Minutes,
        );
        const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
        // The default is the last month, which has day buckets.
        const sql = getOverallResourceConsumptionReportQuery({}, sql2016Metrics, now);
        assert.match(
            sql,
            /^DECLARE @interval_start_time DATETIMEOFFSET = '2026-09-08T06:00:00\.0000000\+00:00';$/m,
        );
        assert.match(sql, /GROUP BY DATEDIFF\(d, 0, rs\.last_execution_time\)/);
        assert.match(
            getOverallResourceConsumptionReportQuery(
                { specifiedTimeInterval: { option: "lastYear" } },
                sql2016Metrics,
                now,
            ),
            /GROUP BY DATEDIFF\(m, 0, rs\.last_execution_time\)/,
        );
    });

    test("sorts in the generator function", () => {
        const config = { specifiedTimeInterval: testTimeInterval, selectedBucketInterval: "hour" };
        const { columns } = overallResourceConsumption(dbOrderMetrics, config);
        assert.equal(
            overallResourceConsumption(dbOrderMetrics, config, columns[3], false).sql,
            csharp.overallDbOrderHourSortedGenerator,
        );
    });

    test("returns a total column for each metric and the bucket columns", () => {
        const { columns } = overallResourceConsumption(dbOrderMetrics, {
            specifiedTimeInterval: testTimeInterval,
        });
        assert.deepEqual(ids(columns), [
            "total_count_executions",
            "total_duration",
            "total_cpu_time",
            "total_logical_io_reads",
            "total_logical_io_writes",
            "total_physical_io_reads",
            "total_clr_time",
            "total_dop",
            "total_query_max_used_memory",
            "total_rowcount",
            "total_log_bytes_used",
            "total_tempdb_space_used",
            "total_query_wait_time",
            "bucket_start",
            "bucket_end",
        ]);
        assert.deepEqual(
            columns.slice(-2).map((column) => column.kind),
            ["bucketStartTime", "bucketEndTime"],
        );
    });

    test("rejects configurations that are not valid", () => {
        assert.throws(
            () =>
                getOverallResourceConsumptionReportQuery(
                    { selectedBucketInterval: "decade" },
                    sql2016Metrics,
                ),
            RangeError,
        );
        assert.throws(
            () =>
                getOverallResourceConsumptionReportQuery(
                    { selectedMetrics: ["bogus"] },
                    sql2016Metrics,
                ),
            RangeError,
        );
        assert.throws(
            () =>
                getOverallResourceConsumptionReportQuery(
                    { displayTimeKind: "pacific" },
                    sql2016Metrics,
                ),
            RangeError,
        );
    });
});
