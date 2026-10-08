/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError, sessionPreamble } = require("../dist/index.js");
const perf = require("../dist/performance/index.js");
const {
    allMetrics,
    platforms,
    probe,
    resultSet,
    scriptedReader,
} = require("../test-fixtures/fakeReader.js");

const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
const options = { now };
const info = platforms.sql2022;

const planColumns = ["query_id", "time_window", "plan_id", "query_plan_hash"];
const plan = (queryId, timeWindow, planId, hash) => ({
    queryId,
    timeWindow,
    planId,
    queryPlanHash: hash,
});

/** A Regressed Queries row for each query ID. */
function regressedSet(queryIds) {
    const { columns } = perf.regressedQuerySummary({});
    return resultSet(
        columns.map((column) => column.id),
        queryIds.map((queryId) =>
            columns.map((column) => (column.kind === "queryId" ? queryId : 1)),
        ),
    );
}

suite("regressed plan changes", () => {
    test("a new plan hash in the recent window is a new plan", () => {
        const [change] = perf.computeRegressedPlanChanges(
            ["5"],
            [
                plan("5", "history", "10", "0xAAAA"),
                plan("5", "recent", "10", "0xAAAA"),
                plan("5", "recent", "11", "0xBBBB"),
            ],
        );
        assert.deepEqual(change, {
            queryId: "5",
            newPlan: true,
            baselinePlanRetained: true,
            newPlanHashes: ["0xBBBB"],
            history: { planCount: 1, planIds: ["10"], planHashes: ["0xAAAA"] },
            recent: { planCount: 2, planIds: ["10", "11"], planHashes: ["0xAAAA", "0xBBBB"] },
        });
    });

    test("the same hash with a new plan_id is not a new plan", () => {
        const [change] = perf.computeRegressedPlanChanges(
            ["5"],
            [plan("5", "history", "10", "0xAAAA"), plan("5", "recent", "12", "0xAAAA")],
        );
        assert.equal(change.newPlan, false);
        assert.deepEqual(change.newPlanHashes, []);
        assert.equal(change.history.planCount, 1);
        assert.equal(change.recent.planCount, 1);
        assert.deepEqual(change.recent.planIds, ["12"]);
    });

    test("a baseline without plans is not retained and is not compared", () => {
        const [change, other] = perf.computeRegressedPlanChanges(
            ["5", "6"],
            [plan("5", "recent", "12", "0xAAAA"), plan("6", "history", "20", "0xCCCC")],
        );
        assert.equal(change.baselinePlanRetained, false);
        assert.equal(change.newPlan, false);
        assert.deepEqual(change.history, { planCount: 0, planIds: [], planHashes: [] });
        assert.equal(change.recent.planCount, 1);
        assert.equal(other.baselinePlanRetained, true);
        assert.equal(other.newPlan, false);
        assert.equal(other.recent.planCount, 0);
    });

    test("sorts plan IDs as numbers", () => {
        const [change] = perf.computeRegressedPlanChanges(
            ["5"],
            [
                plan("5", "history", "100", "0x01"),
                plan("5", "history", "9", "0x01"),
                plan("5", "history", "9223372036854775807", undefined),
            ],
        );
        assert.deepEqual(change.history.planIds, ["9", "100", "9223372036854775807"]);
        assert.deepEqual(change.history.planHashes, ["0x01"]);
    });
});

suite("regressed plan changes query", () => {
    test("lists the plans of each window with the report's window filter", () => {
        const sql = perf.buildRegressedPlanChangesQuery(
            info,
            {},
            ["5", "9007199254740993"],
            false,
            now,
        );
        assert.ok(sql.startsWith(`${sessionPreamble(info, "read")}\nDECLARE @recent_start_time`));
        assert.match(
            sql,
            /WHERE p\.query_id IN \(CAST\(5 AS bigint\), CAST\(9007199254740993 AS bigint\)\)/,
        );
        assert.match(
            sql,
            /NOT \(rs\.first_execution_time > w\.end_time OR rs\.last_execution_time < w\.start_time\)/,
        );
        assert.match(sql, /\(N'history', @history_start_time, @history_end_time\)/);
        assert.match(sql, /\(N'recent', @recent_start_time, @recent_end_time\)/);
        assert.match(sql, /CONVERT\(varchar\(18\), p\.query_plan_hash, 1\) AS query_plan_hash/);
        assert.doesNotMatch(sql, /STRING_SPLIT|MAXDOP|replica_group_id/);
    });

    test("declares the same windows as the report", () => {
        const config = {
            timeIntervalRecent: { option: "last12Hours" },
            timeIntervalHistory: { option: "lastMonth" },
        };
        const sql = perf.buildRegressedPlanChangesQuery(info, config, ["5"], false, now);
        const report = perf.getRegressedQueriesSummaryReportQuery(config, now);
        for (const name of [
            "@recent_start_time",
            "@recent_end_time",
            "@history_start_time",
            "@history_end_time",
        ]) {
            const declaration = report.split("\n").find((line) => line.includes(`${name} `));
            assert.ok(sql.includes(declaration), declaration);
        }
    });

    test("filters by the replica group and splits long ID lists", () => {
        const ids = Array.from({ length: 501 }, (_, index) => String(index + 1));
        const sql = perf.buildRegressedPlanChangesQuery(
            info,
            { replicaGroupId: 3 },
            ids,
            true,
            now,
        );
        assert.match(sql, /DECLARE @replica_group_id BIGINT = 3;/);
        assert.match(sql, /AND rs\.replica_group_id = @replica_group_id/);
        assert.equal(sql.match(/FROM sys\.query_store_plan AS p/g).length, 2);
        assert.match(sql, /IN \(CAST\(501 AS bigint\)\)/);
    });

    test("rejects IDs that are not bigint values", () => {
        assert.throws(
            () =>
                perf.buildRegressedPlanChangesQuery(info, {}, ["1); DROP TABLE t; --"], false, now),
            RangeError,
        );
        assert.throws(
            () => perf.buildRegressedPlanChangesQuery(info, {}, [], false, now),
            RangeError,
        );
    });
});

suite("runRegressedQueriesSummary", () => {
    test("sorts by the regression and flags new plans for each row", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [regressedSet(["5", "6"])],
            [
                resultSet(planColumns, [
                    ["5", "history", "10", "0xaaaa"],
                    ["5", "recent", "11", "0xBBBB"],
                ]),
                resultSet(planColumns, [
                    ["6", "history", "20", "0xCCCC"],
                    ["6", "recent", "21", "0xCCCC"],
                ]),
            ],
        ]);
        const result = await perf.runRegressedQueriesSummary(reader, info, {}, options);

        assert.equal(result.status, "ready");
        assert.deepEqual(result.missing, []);
        assert.equal(reader.calls.length, 3);
        for (const sql of reader.calls) {
            assert.ok(sql.startsWith(sessionPreamble(info, "read")));
            assert.doesNotMatch(sql, /MAXDOP/);
        }
        assert.match(
            reader.calls[1],
            /\nORDER BY additional_duration_workload DESC\nOPTION \(MERGE JOIN\)$/,
        );
        const declarations = perf.getRegressedQueriesSummaryReportQuery({}, now).split("\n\n")[0];
        assert.ok(reader.calls[1].includes(`${declarations}\n\nWITH \nhist AS`));
        assert.match(reader.calls[2], /IN \(CAST\(5 AS bigint\), CAST\(6 AS bigint\)\)/);

        assert.deepEqual(
            result.data.planChanges.map((change) => [
                change.queryId,
                change.newPlan,
                change.baselinePlanRetained,
            ]),
            [
                ["5", true, true],
                ["6", false, true],
            ],
        );
        assert.deepEqual(result.data.planChanges[0].history.planHashes, ["0xAAAA"]);
        assert.equal(result.data.rows.length, 2);
    });

    test("does not read plans when no query regressed", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics }), [regressedSet([])]]);
        const result = await perf.runRegressedQueriesSummary(reader, info, {}, options);
        assert.equal(result.status, "noData");
        assert.deepEqual(result.data.planChanges, []);
        assert.equal(reader.calls.length, 2);
    });

    test("keeps the report when the plan read fails", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [regressedSet(["5"])],
            new SqlReadError("Lock request time out period exceeded.", "server", 1222),
        ]);
        const result = await perf.runRegressedQueriesSummary(reader, info, {}, options);
        assert.equal(result.status, "ready");
        assert.deepEqual(result.missing, ["regressedPlanChanges"]);
        assert.equal(result.data.planChanges, undefined);
        assert.equal(result.data.rows.length, 1);
    });

    test("a cancel of the plan read stops the run", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [regressedSet(["5"])],
            new SqlReadError("Canceled", "canceled"),
        ]);
        const result = await perf.runRegressedQueriesSummary(reader, info, {}, options);
        assert.equal(result.status, "temporarilyUnavailable");
    });

    test("filters the plans by the replica group of the report", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics, replicaColumn: true }),
            [regressedSet(["5"])],
            [resultSet(planColumns)],
        ]);
        await perf.runRegressedQueriesSummary(reader, info, { replicaGroupId: 2 }, options);
        assert.match(reader.calls[1], /DECLARE @replica_group_id BIGINT = 2;/);
        assert.match(reader.calls[2], /DECLARE @replica_group_id BIGINT = 2;/);
        assert.match(reader.calls[2], /AND rs\.replica_group_id = @replica_group_id/);
    });

    test("the detailed report has every metric and the plan flags", async () => {
        const { columns } = perf.regressedQueryDetailedSummary(allMetrics, {});
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [
                resultSet(
                    columns.map((column) => column.id),
                    [columns.map((column) => (column.kind === "queryId" ? 5 : "2.5"))],
                ),
            ],
            [
                resultSet(planColumns, [
                    ["5", "history", "10", "0x01"],
                    ["5", "recent", "10", "0x01"],
                ]),
            ],
        ]);
        const result = await perf.runRegressedQueriesDetailedSummary(reader, info, {}, options);
        assert.equal(result.status, "ready");
        assert.match(reader.calls[1], /ORDER BY additional_duration_workload DESC/);
        assert.equal(result.data.planChanges[0].newPlan, false);
        const regression = perf.findReportColumn(result.data.columns, {
            kind: "statisticMetricRegression",
            metric: "cpuTime",
        });
        assert.deepEqual(regression, {
            id: "additional_cpu_time_workload",
            kind: "statisticMetricRegression",
            valueType: "number",
            metric: "cpuTime",
            statistic: "total",
            unit: "millisecond",
        });
        const recent = perf.findReportColumn(result.data.columns, {
            metric: "cpuTime",
            timeInterval: "recent",
        });
        assert.equal(recent.id, "total_cpu_time_recent");
        assert.equal(result.data.rows[0].total_cpu_time_recent, 2.5);
    });

    test("a percent regression has the percent unit", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics }), [regressedSet([])]]);
        const result = await perf.runRegressedQueriesSummary(
            reader,
            info,
            { selectedStatistic: "avg" },
            options,
        );
        const regression = perf.findReportColumn(result.data.columns, {
            kind: "statisticMetricRegression",
        });
        assert.equal(regression.id, "duration_regr_perc_recent");
        assert.equal(regression.unit, "percent");
        assert.match(reader.calls[1], /ORDER BY duration_regr_perc_recent DESC/);
    });
});
