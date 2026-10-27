/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError, sessionPreamble } = require("../dist/index.js");
const qs = require("../dist/queryStore/index.js");
const {
    capabilities,
    platforms,
    resultSet,
    scriptedReader,
    stateSet,
} = require("../test-fixtures/fakeReader.js");

const window = {
    start: new Date(Date.UTC(2026, 9, 1)),
    end: new Date(Date.UTC(2026, 9, 2)),
};

/** The four sums of a metric column, in the recorded unit. */
const sums = (column, [total, min, max, squares]) => ({
    columns: [`${column}_total`, `${column}_min`, `${column}_max`, `${column}_sq`],
    values: [total, min, max, squares],
});

function statsSet(leading, rows) {
    return resultSet(
        [...leading.columns, "executions", ...rows[0].sums.flatMap((part) => part.columns)],
        rows.map((row) => [
            ...row.leading,
            row.executions,
            ...row.sums.flatMap((part) => part.values),
        ]),
    );
}

suite("Query Store capabilities", () => {
    test("reads the columns once on platforms with Query Store", async () => {
        const reader = scriptedReader([
            [resultSet(["engine_edition", "product_version"], [[3, "13.0.6300.2"]])],
            [
                resultSet(
                    [
                        "has_log_bytes",
                        "has_tempdb",
                        "has_replica_groups",
                        "has_plan_forcing_type",
                        "has_plan_type",
                        "has_capture_policy",
                        "has_wait_stats_capture",
                    ],
                    [[0, 0, 0, 0, 0, 0, 0]],
                ),
            ],
        ]);
        const result = await qs.readQueryStoreCapabilities(reader);

        assert.equal(result.supported, true);
        assert.equal(result.platform.majorVersion, 13);
        assert.ok(!result.metrics.includes("logBytesUsed"));
        assert.ok(!result.metrics.includes("tempdbSpaceUsed"));
        assert.ok(result.metrics.includes("cpuTime"));
        assert.equal(result.hasPlanForcingType, false);
        assert.equal(reader.calls.length, 2);
    });

    test("does not probe a platform without Query Store", async () => {
        const reader = scriptedReader([
            [
                resultSet(
                    ["engine_edition", "product_version", "data_lake_log_publishing"],
                    [[11, "12.0.2000.8", "AUTO"]],
                ),
            ],
        ]);
        const result = await qs.readQueryStoreCapabilities(reader);

        assert.equal(result.supported, false);
        assert.equal(reader.calls.length, 1);
        const read = await qs.getTopQueries(reader, result, {
            ...window,
            rankBy: "cpuTime",
            top: 10,
        });
        assert.equal(read.status, "unsupported");
        assert.equal(reader.calls.length, 1);
    });
});

suite("Query Store reads", () => {
    test("reads the top queries and the workload in one batch", async () => {
        const reader = scriptedReader([
            [
                stateSet(),
                statsSet({ columns: [] }, [
                    {
                        leading: [],
                        executions: 100,
                        sums: [sums("cpu_time", [8_000_000, 100, 900_000, 0])],
                    },
                ]),
                statsSet(
                    {
                        columns: [
                            "query_id",
                            "plan_count",
                            "rank_value",
                            "query_text",
                            "object_schema_name",
                            "object_name",
                            "last_execution_time",
                        ],
                    },
                    [
                        {
                            leading: [
                                "9223372036854775807",
                                2,
                                5_000_000,
                                "SELECT 1",
                                "dbo",
                                "usp_Orders",
                                "2026-10-01 12:00:00.0000000 +00:00",
                            ],
                            executions: 40,
                            sums: [sums("cpu_time", [5_000_000, 1_000, 500_000, 40 * 10_000 ** 2])],
                        },
                    ],
                ),
            ],
        ]);
        const result = await qs.getTopQueries(reader, capabilities(), {
            ...window,
            rankBy: "cpuTime",
            statistic: "avg",
            top: 25,
        });

        assert.equal(result.status, "ready");
        assert.deepEqual(result.queryStore, { actualState: "readWrite" });
        const [query] = result.data.queries;
        assert.equal(query.queryId, "9223372036854775807");
        assert.equal(query.objectName, "dbo.usp_Orders");
        assert.equal(query.planCount, 2);
        assert.equal(query.executionCount, 40);
        assert.equal(query.lastExecutionTimeUtc, "2026-10-01T12:00:00.000Z");
        assert.deepEqual(query.metrics.cpuTime, {
            total: 5000,
            avg: 125,
            min: 1,
            max: 500,
            stdev: 10,
        });
        assert.equal(result.data.workload.executionCount, 100);
        assert.equal(result.data.workload.metrics.cpuTime.total, 8000);

        const sql = reader.calls[0];
        assert.equal(reader.calls.length, 1);
        assert.ok(sql.startsWith(sessionPreamble(platforms.sql2022, "read")));
        assert.match(
            sql,
            /DECLARE @window_start datetimeoffset = CAST\(N'2026-10-01T00:00:00\.000Z'/,
        );
        assert.match(sql, /SELECT TOP \(25\)/);
        assert.match(
            sql,
            /SUM\(pl\.cpu_time_total\) \/ NULLIF\(SUM\(pl\.executions\), 0\) AS rank_value/,
        );
        assert.match(sql, /LEFT\(qt\.query_sql_text, 4000\)/);
        assert.doesNotMatch(sql, /replica_group_id/);
    });

    test("counts only the primary replica on a server with replica groups", async () => {
        const reader = scriptedReader([[stateSet(), resultSet(["executions"], [[0]])]]);
        await qs.getTopQueries(reader, capabilities({ hasReplicaGroups: true }), {
            ...window,
            rankBy: "executionCount",
            top: 5,
        });

        assert.match(reader.calls[0], /AND rs\.replica_group_id = 1/);
        assert.match(reader.calls[0], /SUM\(pl\.executions\) AS rank_value/);
    });

    test("gives notConfigured when Query Store is off or in the error state", async () => {
        for (const state of [0, 3]) {
            const reader = scriptedReader([[stateSet(state)]]);
            const result = await qs.getTopQueries(reader, capabilities(), {
                ...window,
                rankBy: "duration",
                top: 5,
            });
            assert.equal(result.status, "notConfigured");
            assert.match(reader.calls[0], /IF @qs_state IN \(1, 2, 4\)/);
        }
    });

    test("reports a read-only Query Store and its reason", async () => {
        const reader = scriptedReader([[stateSet(1, 0x10000), resultSet(["executions"], [[0]])]]);
        const result = await qs.getTopQueries(reader, capabilities(), {
            ...window,
            rankBy: "duration",
            top: 5,
        });

        assert.equal(result.status, "noData");
        assert.deepEqual(result.queryStore, {
            actualState: "readOnly",
            readOnlyReason: "sizeLimit",
        });
    });

    test("maps read failures to statuses", async () => {
        const reader = scriptedReader([
            new SqlReadError("Lock request time out period exceeded.", "server", 1222),
            new SqlReadError("VIEW DATABASE STATE permission denied", "server", 297),
        ]);
        const request = { ...window, rankBy: "duration", top: 5 };
        const timeout = await qs.getTopQueries(reader, capabilities(), request);
        const denied = await qs.getTopQueries(reader, capabilities(), request);

        assert.equal(timeout.status, "temporarilyUnavailable");
        assert.equal(timeout.error.errorNumber, 1222);
        assert.equal(denied.status, "permissionMissing");
    });

    test("checks the request before it reads", async () => {
        const reader = scriptedReader([]);
        await assert.rejects(
            qs.getTopQueries(reader, capabilities(), { ...window, rankBy: "cpu", top: 5 }),
            RangeError,
        );
        await assert.rejects(
            qs.getTopQueries(reader, capabilities(), { ...window, rankBy: "duration", top: 0 }),
            RangeError,
        );
        await assert.rejects(
            qs.getQueryDetails(reader, capabilities(), {
                ...window,
                queryId: "1; DROP TABLE t",
                metrics: [],
            }),
            RangeError,
        );
        await assert.rejects(
            qs.getQueryHistory(reader, capabilities(), {
                start: window.end,
                end: window.start,
                queryId: "1",
                metrics: [],
            }),
            RangeError,
        );
        assert.equal(reader.calls.length, 0);
    });

    test("gives unsupported for a metric that the server does not record", async () => {
        const reader = scriptedReader([]);
        const result = await qs.getTopQueries(
            reader,
            capabilities({ metrics: ["duration", "cpuTime"] }),
            { ...window, rankBy: "tempdbSpaceUsed", top: 5 },
        );

        assert.equal(result.status, "unsupported");
        assert.equal(reader.calls.length, 0);
    });

    test("reads the details of a query", async () => {
        const reader = scriptedReader([
            [
                stateSet(),
                resultSet(
                    [
                        "query_text",
                        "object_schema_name",
                        "object_name",
                        "last_execution_time",
                        "total_plan_count",
                        "forced_plan_id",
                    ],
                    [["SELECT * FROM t", null, null, null, 3, "7"]],
                ),
                statsSet({ columns: ["plan_count"] }, [
                    {
                        leading: [2],
                        executions: 10,
                        sums: [sums("duration", [20_000, 1_000, 3_000, 0])],
                    },
                ]),
            ],
        ]);
        const result = await qs.getQueryDetails(reader, capabilities(), {
            ...window,
            queryId: "42",
            metrics: ["duration"],
        });

        assert.equal(result.status, "ready");
        assert.equal(result.data.queryId, "42");
        assert.equal(result.data.queryText, "SELECT * FROM t");
        assert.equal(result.data.objectName, undefined);
        assert.equal(result.data.planCount, 2);
        assert.equal(result.data.totalPlanCount, 3);
        assert.equal(result.data.forcedPlanId, "7");
        assert.equal(result.data.metrics.duration.avg, 2);
        assert.match(reader.calls[0], /DECLARE @query_id bigint = CAST\(42 AS bigint\);/);
    });

    test("gives noData for a query that Query Store does not have", async () => {
        const reader = scriptedReader([[stateSet(), resultSet(["query_text"]), resultSet([])]]);
        const result = await qs.getQueryDetails(reader, capabilities(), {
            ...window,
            queryId: "42",
            metrics: ["duration"],
        });

        assert.equal(result.status, "noData");
    });

    test("groups the history by interval and combines the plans of each", async () => {
        const interval = (start, planId, executions, total, min, max) => ({
            leading: [start, start.replace("00:00", "59:59"), planId],
            executions,
            sums: [sums("duration", [total, min, max, 0])],
        });
        const reader = scriptedReader([
            [
                stateSet(),
                statsSet({ columns: ["start_time", "end_time", "plan_id"] }, [
                    interval("2026-10-01T00:00:00Z", "1", 4, 4_000, 500, 2_000),
                    interval("2026-10-01T00:00:00Z", "2", 6, 18_000, 1_000, 5_000),
                    interval("2026-10-01T01:00:00Z", "2", 1, 1_000, 1_000, 1_000),
                ]),
            ],
        ]);
        const result = await qs.getQueryHistory(reader, capabilities(), {
            ...window,
            queryId: "42",
            metrics: ["duration"],
        });

        assert.equal(result.data.length, 2);
        const [first, second] = result.data;
        assert.equal(first.startUtc, "2026-10-01T00:00:00.000Z");
        assert.deepEqual(
            first.plans.map((plan) => plan.planId),
            ["1", "2"],
        );
        assert.equal(first.executionCount, 10);
        assert.equal(first.metrics.duration.total, 22);
        assert.equal(first.metrics.duration.avg, 2.2);
        assert.equal(first.metrics.duration.min, 0.5);
        assert.equal(first.metrics.duration.max, 5);
        assert.equal(second.executionCount, 1);
        assert.doesNotMatch(reader.calls[0], /@bucket_minutes/);
    });

    test("sums the history into buckets of a multiple of the interval length", async () => {
        const reader = scriptedReader([
            [stateSet(), resultSet(["start_time", "end_time", "plan_id"])],
        ]);
        await qs.getQueryHistory(reader, capabilities(), {
            ...window,
            queryId: "42",
            metrics: ["duration"],
            bucketMinutes: 240,
        });

        const sql = reader.calls[0];
        assert.match(sql, /DECLARE @bucket_minutes int = 240;/);
        assert.match(sql, /CEILING\(1\.0 \* @bucket_minutes \/ interval_length_minutes\)/);
        assert.match(sql, /CROSS APPLY \(SELECT DATEADD\(minute, DATEDIFF\(minute, @bucket_epoch/);
        assert.match(sql, /GROUP BY b\.bucket_start, rs\.plan_id/);
    });

    test("picks the shortest bucket that keeps a window to the most buckets", () => {
        const hours = (count) => ({
            start: new Date(0),
            end: new Date(count * 60 * 60 * 1000),
        });
        assert.equal(qs.historyBucketMinutes(hours(1), 200), 1);
        assert.equal(qs.historyBucketMinutes(hours(24), 200), 10);
        assert.equal(qs.historyBucketMinutes(hours(24 * 7), 200), 60);
        assert.equal(qs.historyBucketMinutes(hours(24 * 30), 200), 240);
        assert.equal(qs.historyBucketMinutes(hours(24 * 30), 48), 1440);
        assert.equal(qs.historyBucketMinutes(hours(24 * 365 * 5), 48), 7 * 24 * 60);
    });

    test("rejects a history bucket outside 1 minute to a week", async () => {
        const reader = scriptedReader([]);
        for (const bucketMinutes of [0, 1.5, 7 * 24 * 60 + 1]) {
            await assert.rejects(
                qs.getQueryHistory(reader, capabilities(), {
                    ...window,
                    queryId: "42",
                    metrics: ["duration"],
                    bucketMinutes,
                }),
                RangeError,
            );
        }
        assert.equal(reader.calls.length, 0);
    });

    test("reads every plan of a query, with no executions for plans that did not run", async () => {
        const planColumns = [
            "plan_id",
            "query_id",
            "query_plan_hash",
            "is_forced_plan",
            "force_failure_count",
            "last_force_failure_reason_desc",
            "last_execution_time",
            "plan_forcing_type_desc",
            "plan_type_desc",
            "is_parallel_plan",
            "count_compiles",
            "initial_compile_start_time",
            "last_compile_start_time",
            "stats_plan_id",
            "executions",
        ];
        const reader = scriptedReader([
            [
                stateSet(),
                resultSet(planColumns, [
                    [
                        "1",
                        "42",
                        "0xabc",
                        true,
                        0,
                        "NONE",
                        null,
                        "MANUAL",
                        "Compiled Plan",
                        false,
                        3,
                        null,
                        null,
                        "1",
                        5,
                    ],
                    [
                        "2",
                        "42",
                        "0xdef",
                        false,
                        2,
                        "NO_INDEX",
                        null,
                        "NONE",
                        "Query Variant Plan",
                        true,
                        1,
                        null,
                        null,
                        null,
                        null,
                    ],
                ]),
            ],
        ]);
        const result = await qs.getQueryPlans(
            reader,
            capabilities({ hasPlanForcingType: false, hasPlanType: false }),
            { ...window, queryId: "42", metrics: [] },
        );

        const [forced, variant] = result.data;
        assert.equal(forced.planHash, "0xABC");
        assert.equal(forced.isForced, true);
        assert.equal(forced.forcingType, "manual");
        assert.equal(forced.lastForceFailureReason, undefined);
        assert.equal(forced.executionCount, 5);
        assert.equal(variant.planType, "variant");
        assert.equal(variant.lastForceFailureReason, "NO_INDEX");
        assert.equal(variant.executionCount, 0);
        assert.deepEqual(variant.metrics, {});
        assert.match(reader.calls[0], /CAST\(NULL AS nvarchar\(60\)\) AS plan_forcing_type_desc/);
    });

    test("reads the plan XML and the overview in every state", async () => {
        const reader = scriptedReader([
            [stateSet(0), resultSet(["query_plan"], [["<ShowPlanXML />"]])],
            [stateSet(0), resultSet(["oldest_start"], [["2026-09-01T00:00:00Z"]])],
        ]);
        const plan = await qs.getPlanXml(reader, capabilities(), "7");
        const overview = await qs.getQueryStoreOverview(reader, capabilities());

        assert.equal(plan.data, "<ShowPlanXML />");
        assert.deepEqual(overview.data, {
            actualState: "off",
            oldestIntervalStartUtc: "2026-09-01T00:00:00.000Z",
        });
        assert.doesNotMatch(reader.calls[0], /IF @qs_state/);
    });
});

suite("combineRuntimeStats", () => {
    test("pools the standard deviation of its parts", () => {
        const combined = qs.combineRuntimeStats([
            {
                executionCount: 1,
                metrics: { duration: { total: 1, avg: 1, min: 1, max: 1, stdev: 3 } },
            },
            {
                executionCount: 3,
                metrics: { duration: { total: 9, avg: 3, min: 2, max: 4, stdev: 1 } },
            },
        ]);

        assert.equal(combined.executionCount, 4);
        assert.deepEqual(combined.metrics.duration, {
            total: 10,
            avg: 2.5,
            min: 1,
            max: 4,
            stdev: Math.sqrt((9 + 3) / 4),
        });
    });
});
