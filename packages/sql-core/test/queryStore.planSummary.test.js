/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    comparePlanKeys,
    forcedPlanQuery,
    getForcePlanQuery,
    getForcedPlanQuery,
    getPlanSummaryChartViewQuery,
    getPlanSummaryGridViewQuery,
    getUnforcePlanQuery,
    isEmptyPlanKey,
    planExecutionTypeFromId,
    planSummaryChartView,
    planSummaryGridView,
    trackedQueriesPlanSummaryConfiguration,
} = require("../dist/performance/index.js");
const baselines = require("../test-fixtures/queryStoreBaselines.js");
const csharp = require("../test-fixtures/queryStoreCSharpOutputs.js");
const {
    addMinutes,
    ids,
    testTimeInterval,
    testWindowStart,
    withDeclarations,
} = require("../test-fixtures/queryStoreTestSettings.js");

// QueryStoreTests.cs: the PlanSummary test.
const baselineConfig = {
    queryId: 97,
    timeInterval: testTimeInterval,
    timeIntervalMode: "specifiedRange",
    selectedMetric: "waitTime",
    selectedStatistic: "stdev",
};

function harnessConfig(selectedMetric, minutes, extra = {}) {
    return {
        queryId: 97,
        selectedMetric,
        selectedStatistic: "stdev",
        timeInterval: { start: testWindowStart, end: addMinutes(testWindowStart, minutes) },
        ...extra,
    };
}

const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
const nowDeclaration =
    "DECLARE @interval_start_time DATETIMEOFFSET = '2026-10-08T06:00:00.0000000+00:00';";

suite("Plan Summary", () => {
    test("matches the SQL Tools Service baselines", () => {
        assert.equal(
            getPlanSummaryChartViewQuery(baselineConfig),
            baselines.handleGetPlanSummaryChartViewRequest,
        );
        assert.equal(
            getPlanSummaryGridViewQuery(baselineConfig, "count_executions", true),
            baselines.handleGetPlanSummaryGridViewRequest,
        );
    });

    test("picks the chart bucket from the length of the window", () => {
        assert.equal(
            getPlanSummaryChartViewQuery(harnessConfig("cpuTime", 30)),
            csharp.planSummaryChartCpuMinute,
        );
        assert.equal(
            getPlanSummaryChartViewQuery(
                harnessConfig("duration", 576000, { replicaGroupId: 2, isQdsRoAvailable: true }),
            ),
            withDeclarations(
                csharp.planSummaryChartDurationSecondaryReplicaMonth,
                "DECLARE @replica_group_id BIGINT = 2;",
            ),
        );
    });

    test("declares the interval start for all history, which the C# code leaves out", () => {
        const chart = getPlanSummaryChartViewQuery(
            harnessConfig("executionCount", 30, { timeIntervalMode: "allHistory" }),
            now,
        );
        assert.equal(
            chart,
            withDeclarations(csharp.planSummaryChartExecutionCountAllHistory, nowDeclaration),
        );
        const grid = getPlanSummaryGridViewQuery(
            harnessConfig("cpuTime", 10080, { timeIntervalMode: "allHistory" }),
            "plan_id",
            false,
            now,
        );
        assert.equal(grid, withDeclarations(csharp.planSummaryGridCpuAllHistory, nowDeclaration));
    });

    test("matches the C# output for the execution count grid", () => {
        assert.equal(
            getPlanSummaryGridViewQuery(
                harnessConfig("executionCount", 10080, { isQdsRoAvailable: true }),
            ),
            withDeclarations(
                csharp.planSummaryGridExecutionCountReplica,
                "DECLARE @replica_group_id BIGINT = 1;",
            ),
        );
        // The C# template is not valid SQL for a secondary replica. This port keeps it.
        const secondary = getPlanSummaryGridViewQuery(
            harnessConfig("executionCount", 10080, { replicaGroupId: 2 }),
        );
        assert.equal(
            secondary,
            withDeclarations(
                csharp.planSummaryGridExecutionCountSecondary,
                "DECLARE @replica_group_id BIGINT = 2;",
            ),
        );
        assert.match(secondary, /\nWHERE p\.query_id = @query_id\n@replica_group_id\n/);
    });

    test("matches the C# output for wait time with a replica group", () => {
        assert.equal(
            getPlanSummaryGridViewQuery(
                harnessConfig("waitTime", 10080, { isQdsRoAvailable: true }),
            ),
            withDeclarations(
                csharp.planSummaryGridWaitTimeReplica,
                "DECLARE @replica_group_id BIGINT = 1;",
            ),
        );
    });

    test("returns the chart and grid columns", () => {
        const config = harnessConfig("cpuTime", 60);
        assert.deepEqual(ids(planSummaryChartView(config, "hour").columns), [
            "plan_id",
            "is_forced_plan",
            "execution_type",
            "count_executions",
            "bucket_start",
            "bucket_end",
            "avg_cpu_time",
            "max_cpu_time",
            "min_cpu_time",
            "stdev_cpu_time",
            "variation_cpu_time",
            "total_cpu_time",
        ]);
        assert.deepEqual(ids(planSummaryGridView(config).columns), [
            "plan_id",
            "is_forced_plan",
            "execution_type",
            "count_executions",
            "min_cpu_time",
            "max_cpu_time",
            "avg_cpu_time",
            "stdev_cpu_time",
            "variation_cpu_time",
            "last_cpu_time",
            "total_cpu_time",
            "first_execution_time",
            "last_execution_time",
        ]);
        assert.deepEqual(ids(planSummaryGridView(harnessConfig("executionCount", 60)).columns), [
            "plan_id",
            "is_forced_plan",
            "execution_type",
            "count_executions",
            "first_execution_time",
            "last_execution_time",
        ]);
    });

    test("uses the C# defaults", () => {
        const sql = getPlanSummaryChartViewQuery({ queryId: "9223372036854775807" }, now);
        assert.ok(
            sql.startsWith(
                "DECLARE @query_id BIGINT = 9223372036854775807;\n" +
                    "DECLARE @interval_start_time DATETIMEOFFSET = '2026-10-08T05:55:00.0000000+00:00';\n" +
                    "DECLARE @interval_end_time DATETIMEOFFSET = '2026-10-08T06:00:00.0000000+00:00';\n\n",
            ),
        );
        assert.match(sql, / as avg_cpu_time,$/m);
        assert.match(sql, /DATEDIFF\(mi, 0, rs\.last_execution_time\)/);
    });

    test("rejects configurations that are not valid", () => {
        const invalid = [
            {},
            { queryId: "97; DROP TABLE t" },
            { queryId: 97, timeIntervalMode: "someHistory" },
            { queryId: 97, replicaGroupId: -1.5 },
            { queryId: 97, selectedMetric: "bogus" },
        ];
        for (const config of invalid) {
            assert.throws(
                () => getPlanSummaryChartViewQuery(config, now),
                RangeError,
                JSON.stringify(config),
            );
        }
        assert.throws(
            () => getPlanSummaryGridViewQuery({ queryId: 97 }, "plan_id DESC; --"),
            RangeError,
        );
    });
});

suite("Forced plan queries", () => {
    test("matches the C# output", () => {
        assert.equal(getForcedPlanQuery(97, 3), csharp.forcedPlanQuery);
        assert.equal(forcedPlanQuery(false), csharp.forcedPlanQuerySecondaryGenerator);
        assert.equal(
            getForcedPlanQuery(97, 3, 2),
            `DECLARE @query_id BIGINT = 97;\nDECLARE @plan_id BIGINT = 3;\nDECLARE @replica_group_id BIGINT = 2;\n\n${csharp.forcedPlanQuerySecondaryGenerator}`,
        );
    });

    test("forces and unforces plans with the stored procedures", () => {
        assert.equal(
            getForcePlanQuery(97, 3),
            "DECLARE @query_id BIGINT = 97;\nDECLARE @plan_id BIGINT = 3;\n\n" +
                "EXEC sys.sp_query_store_force_plan @query_id = @query_id, @plan_id = @plan_id;",
        );
        assert.equal(
            getUnforcePlanQuery("97", 3n, 2),
            "DECLARE @query_id BIGINT = 97;\nDECLARE @plan_id BIGINT = 3;\nDECLARE @replica_group_id BIGINT = 2;\n\n" +
                "EXEC sys.sp_query_store_unforce_plan @query_id = @query_id, @plan_id = @plan_id, @replica_group_id = @replica_group_id;",
        );
        assert.throws(() => getForcePlanQuery("1; DROP TABLE t", 3), RangeError);
        assert.throws(() => getUnforcePlanQuery(1, 2.5), RangeError);
    });
});

suite("Plan helpers", () => {
    test("applies the Tracked Queries defaults", () => {
        assert.deepEqual(trackedQueriesPlanSummaryConfiguration(), {
            queryId: 0,
            selectedMetric: "duration",
            selectedStatistic: "avg",
            timeInterval: { option: "lastDay" },
            replicaGroupId: 1,
        });
        const sql = getPlanSummaryChartViewQuery(
            trackedQueriesPlanSummaryConfiguration({ queryId: 5 }),
            now,
        );
        assert.match(
            sql,
            /^DECLARE @interval_start_time DATETIMEOFFSET = '2026-10-07T06:00:00\.0000000\+00:00';$/m,
        );
        assert.match(sql, / as avg_duration,$/m);
    });

    test("maps execution types and compares plan keys", () => {
        assert.equal(planExecutionTypeFromId(0), "completed");
        assert.equal(planExecutionTypeFromId(3), "canceled");
        assert.equal(planExecutionTypeFromId(4), "failed");
        assert.equal(planExecutionTypeFromId(7), "invalid");
        const keys = [
            { planId: "10", executionType: "failed" },
            { planId: "9223372036854775807", executionType: "completed" },
            { planId: "10", executionType: "completed" },
            { planId: "2", executionType: "canceled" },
        ];
        assert.deepEqual(
            [...keys].sort(comparePlanKeys).map((key) => `${key.planId}:${key.executionType}`),
            ["2:canceled", "10:completed", "10:failed", "9223372036854775807:completed"],
        );
        assert.equal(isEmptyPlanKey({ planId: "0", executionType: "completed" }), true);
        assert.equal(isEmptyPlanKey({ planId: "5", executionType: "invalid" }), true);
        assert.equal(isEmptyPlanKey({ planId: "5", executionType: "completed" }), false);
    });
});
