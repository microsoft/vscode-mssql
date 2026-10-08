/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The C# local time fixtures were generated in Pacific time. The test runner runs each file in
// its own process, so this does not change the other tests.
process.env.TZ = "America/Los_Angeles";

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    formatDateTimeOffset,
    getOverallResourceConsumptionReportQuery,
    getPlanSummaryChartViewQuery,
    getRegressedQueriesSummaryReportQuery,
    getTSqlRepresentation,
    getTopResourceConsumersSummaryReportQuery,
    minDateTimeOffset,
} = require("../dist/performance/index.js");
const csharp = require("../test-fixtures/queryStoreCSharpOutputs.js");
const {
    addMinutes,
    dbOrderMetrics,
    harnessSettings,
    recentTestTimeInterval,
    testTimeInterval,
    testWindowStart,
    withDeclarations,
} = require("../test-fixtures/queryStoreTestSettings.js");

const local = { displayTimeKind: "local" };

suite("Query Store local time", () => {
    test("writes the offset of each time like DateTimeOffset.ToLocalTime", () => {
        assert.equal(
            formatDateTimeOffset(new Date("2023-06-10T12:34:56.789Z"), "local"),
            "2023-06-10T05:34:56.7890000-07:00",
        );
        assert.equal(
            formatDateTimeOffset(new Date("2023-01-10T12:00:00Z"), "local"),
            "2023-01-10T04:00:00.0000000-08:00",
        );
        assert.equal(
            getTSqlRepresentation({
                type: "datetimeoffset",
                value: minDateTimeOffset(),
                displayTimeKind: "local",
            }),
            csharp.localMinDate,
        );
        assert.throws(() => formatDateTimeOffset(new Date(), "pacific"), RangeError);
    });

    test("matches the C# output in local time", () => {
        assert.equal(
            getTopResourceConsumersSummaryReportQuery({
                ...local,
                selectedMetric: "waitTime",
                timeInterval: testTimeInterval,
            }),
            csharp.localTopResourceConsumersWaitTime,
        );
        assert.equal(
            getTopResourceConsumersSummaryReportQuery({
                ...local,
                selectedMetric: "duration",
                timeInterval: {
                    start: new Date("2023-01-10T12:00:00Z"),
                    end: new Date("2023-03-20T12:00:00Z"),
                },
            }),
            csharp.localTopResourceConsumersWinter,
        );
        assert.equal(
            getRegressedQueriesSummaryReportQuery({
                ...harnessSettings,
                ...local,
                selectedMetric: "duration",
                minExecutionCount: 3,
                timeIntervalHistory: testTimeInterval,
                timeIntervalRecent: recentTestTimeInterval,
            }),
            csharp.localRegressedDuration,
        );
        assert.equal(
            getPlanSummaryChartViewQuery({
                ...local,
                queryId: 97,
                selectedMetric: "duration",
                selectedStatistic: "stdev",
                timeInterval: { start: testWindowStart, end: addMinutes(testWindowStart, 10080) },
            }),
            csharp.localPlanSummaryChart,
        );
    });

    test("groups the buckets in local time", () => {
        const sql = getOverallResourceConsumptionReportQuery(
            {
                ...local,
                specifiedTimeInterval: testTimeInterval,
                selectedBucketInterval: "day",
                isQdsRoAvailable: true,
            },
            dbOrderMetrics,
        );
        assert.equal(
            sql,
            withDeclarations(
                csharp.localOverallDbOrderDayReplica,
                "DECLARE @replica_group_id BIGINT = 1;",
            ),
        );
        assert.match(
            sql,
            /GROUP BY DATEDIFF\(d, 0, SWITCHOFFSET\(rs\.last_execution_time, DATEPART\(tz, @interval_start_time\)\)\)/,
        );
    });
});
