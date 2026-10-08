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
    sql2016Metrics,
} = require("../test-fixtures/fakeReader.js");

const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
const options = { now };

/** A result set with the columns of a generated report and the rows. */
function reportSet(columns, rows = []) {
    return resultSet(
        columns.map((column) => column.id),
        rows,
    );
}

/** Every report run function, with a configuration that works on SQL Server 2022. */
const runners = [
    ["runTopResourceConsumersSummary", perf.runTopResourceConsumersSummary, {}],
    ["runTopResourceConsumersDetailedSummary", perf.runTopResourceConsumersDetailedSummary, {}],
    ["runRegressedQueriesSummary", perf.runRegressedQueriesSummary, {}],
    ["runRegressedQueriesDetailedSummary", perf.runRegressedQueriesDetailedSummary, {}],
    ["runHighVariationSummary", perf.runHighVariationSummary, {}],
    ["runHighVariationDetailedSummary", perf.runHighVariationDetailedSummary, {}],
    ["runOverallResourceConsumption", perf.runOverallResourceConsumption, {}],
    ["runForcedPlanQueries", perf.runForcedPlanQueries, {}],
    ["runTrackedQueries", perf.runTrackedQueries, { querySearchText: "orders" }],
    ["runPlanSummaryChart", perf.runPlanSummaryChart, { queryId: 7 }],
    ["runPlanSummaryGrid", perf.runPlanSummaryGrid, { queryId: 7 }],
    ["runWaitStatsByCategory", perf.runWaitStatsByCategory, {}],
    ["runWaitStatsQueriesForCategory", perf.runWaitStatsQueriesForCategory, { waitCategoryId: 3 }],
    ["runQueryWaitCategories", perf.runQueryWaitCategories, { queryId: 7 }],
    ["runQueryText", perf.runQueryText, { queryId: 7 }],
    ["runPlanXml", perf.runPlanXml, { planId: 9 }],
];

function assertReadBatches(reader, info) {
    for (const sql of reader.calls) {
        assert.ok(
            sql.startsWith(sessionPreamble(info, "read")),
            `The batch does not start with the read preamble:\n${sql}`,
        );
        assert.doesNotMatch(sql, /MAXDOP/);
    }
}

suite("Query Store run functions: platforms", () => {
    for (const platform of [
        "sql2014",
        "synapseServerless",
        "fabricWarehouse",
        "sqlAnalyticsEndpoint",
        "unknown",
    ]) {
        test(`every report is unsupported on ${platform} without a read`, async () => {
            for (const [name, run, config] of runners) {
                const reader = scriptedReader([]);
                const result = await run(reader, platforms[platform], config, options);
                assert.equal(result.status, "unsupported", name);
                assert.equal(reader.calls.length, 0, name);
            }
        });
    }

    test("runs on SQL Server 2016, Managed Instance, Azure SQL Database, and Fabric", async () => {
        for (const platform of ["sql2016", "managedInstance", "azureSql", "fabricSqlDatabase"]) {
            const info = platforms[platform];
            const metrics = platform === "sql2016" ? sql2016Metrics : allMetrics;
            const reader = scriptedReader([probe({ metrics }), [resultSet(["query_id"])]]);
            const result = await perf.runTopResourceConsumersSummary(reader, info, {}, options);
            assert.equal(result.status, "noData", platform);
            assert.equal(result.source, "queryStore");
            assert.equal(result.scope, "database");
            assertReadBatches(reader, info);
        }
    });

    test("Synapse dedicated pools allow only duration and execution count", async () => {
        const info = platforms.synapseDedicated;
        const cpu = scriptedReader([probe({ metrics: allMetrics })]);
        const cpuResult = await perf.runTopResourceConsumersSummary(
            cpu,
            info,
            { selectedMetric: "cpuTime" },
            options,
        );
        assert.equal(cpuResult.status, "unsupported");
        assert.equal(cpu.calls.length, 1);

        for (const selectedMetric of ["duration", "executionCount"]) {
            const { columns } = perf.topResourceConsumersSummary({ selectedMetric });
            const reader = scriptedReader([
                probe({ metrics: allMetrics }),
                [reportSet(columns, [[1, 0, "", "SELECT 1", 10, 2, 1].slice(0, columns.length)])],
            ]);
            const result = await perf.runTopResourceConsumersSummary(
                reader,
                info,
                { selectedMetric },
                options,
            );
            assert.equal(result.status, "ready", selectedMetric);
            assert.deepEqual(result.missing, []);
            assert.ok(reader.calls[0].startsWith("SET NOCOUNT ON;\n"));
            assert.ok(reader.calls[1].startsWith("SET NOCOUNT ON;\n"));
        }
    });

    test("Synapse dedicated detailed reports have duration and execution count only", async () => {
        const info = platforms.synapseDedicated;
        const { columns } = perf.topResourceConsumersDetailedSummary(
            ["executionCount", "duration"],
            {},
        );
        const reader = scriptedReader([probe({ metrics: allMetrics }), [reportSet(columns)]]);
        const result = await perf.runTopResourceConsumersDetailedSummary(reader, info, {}, options);
        assert.equal(result.status, "noData");
        assert.deepEqual(result.missing, ["queryStoreResourceMetrics", "queryStoreWaitStats"]);
        assert.doesNotMatch(reader.calls[1], /avg_cpu_time|query_store_wait_stats/);
        assert.deepEqual(
            result.data.columns.filter((column) => column.metric).map((column) => column.metric),
            ["duration", "executionCount"],
        );
    });

    test("Synapse dedicated pools have no plan forcing and no wait stats", async () => {
        const info = platforms.synapseDedicated;
        const forced = scriptedReader([]);
        assert.equal(
            (await perf.runForcedPlanQueries(forced, info, {}, options)).status,
            "unsupported",
        );
        assert.equal(forced.calls.length, 0);

        const waits = scriptedReader([probe({ metrics: allMetrics })]);
        assert.equal(
            (await perf.runWaitStatsByCategory(waits, info, {}, options)).status,
            "unsupported",
        );
    });

    test("tracked queries, query text, and plan XML run on Synapse dedicated pools", async () => {
        const info = platforms.synapseDedicated;
        const reader = scriptedReader([
            probe(),
            [resultSet(["query_plan"], [["<ShowPlanXML />"]])],
        ]);
        const result = await perf.runPlanXml(reader, info, { planId: 9 }, options);
        assert.equal(result.status, "ready");
        assert.deepEqual(result.data, { planId: "9", queryPlan: "<ShowPlanXML />" });
    });
});

suite("Query Store run functions: state and probes", () => {
    const info = platforms.sql2022;

    test("OFF and ERROR give notConfigured after the probe", async () => {
        for (const state of [0, 3]) {
            for (const [name, run, config] of runners) {
                const reader = scriptedReader([probe({ state, metrics: allMetrics })]);
                const result = await run(reader, info, config, options);
                assert.equal(result.status, "notConfigured", `${name} ${state}`);
                assert.equal(reader.calls.length, 1, name);
                assert.equal(result.observedAtUtc, now.toISOString());
            }
        }
    });

    test("READ_ONLY runs the report and adds queryStoreReadOnly", async () => {
        const reader = scriptedReader([
            probe({ state: 1, readOnlyReason: 0x10000 }),
            [resultSet(["query_id", "query_text_id", "query_sql_text"], [[5, 6, "SELECT 1"]])],
        ]);
        const result = await perf.runTrackedQueries(
            reader,
            info,
            { querySearchText: "SELECT" },
            options,
        );
        assert.equal(result.status, "ready");
        assert.deepEqual(result.missing, ["queryStoreReadOnly"]);
    });

    test("every batch starts with the read preamble and has no MAXDOP", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics }), [resultSet(["x"])]]);
        await perf.runTrackedQueries(reader, info, { querySearchText: "x" }, options);
        assert.equal(reader.calls.length, 2);
        assertReadBatches(reader, info);
        assert.match(reader.calls[0], /sys\.database_query_store_options/);
        assert.match(reader.calls[0], /ReplicaColumnExists/);
        // Tracked queries do not need the metrics.
        assert.doesNotMatch(reader.calls[0], /query_store_runtime_stats;/);
    });

    test("passes the signal and the timeout to each batch", async () => {
        const signal = new AbortController().signal;
        const reader = scriptedReader([probe({ metrics: allMetrics }), [resultSet(["query_id"])]]);
        await perf.runTopResourceConsumersSummary(
            reader,
            info,
            {},
            {
                now,
                signal,
                timeoutMs: 3000,
            },
        );
        assert.deepEqual(reader.options, [
            { signal, timeoutMs: 3000 },
            { signal, timeoutMs: 3000 },
        ]);
    });

    test("cached metrics and replica support skip the probes", async () => {
        const reader = scriptedReader([probe({ replicaColumn: undefined }), [resultSet(["a"])]]);
        await perf.runTopResourceConsumersDetailedSummary(
            reader,
            info,
            {},
            {
                now,
                availableMetrics: allMetrics,
                isQdsRoAvailable: false,
            },
        );
        assert.doesNotMatch(reader.calls[0], /query_store_runtime_stats|ReplicaColumnExists/);
        assert.match(reader.calls[1], /avg_log_bytes_used/);
    });

    test("probeQueryStore returns the metrics, the replicas, and the read-only reason", async () => {
        const reader = scriptedReader([
            probe({ state: 1, readOnlyReason: 0x10000, metrics: allMetrics, replicaColumn: true }),
            [
                resultSet(["ReplicaCount"], [[2]]),
                resultSet(["replica_name", "replica_group_id"], [["Secondary", 2]]),
            ],
        ]);
        const result = await perf.probeQueryStore(reader, info, options);
        assert.equal(result.status, "ready");
        assert.deepEqual(result.missing, ["queryStoreReadOnly"]);
        assert.deepEqual(result.data, {
            operationalStatus: "readOnly",
            readOnlyReason: "diskSizeLimit",
            availableMetrics: allMetrics,
            isQdsRoAvailable: true,
            replicas: [
                { replicaGroupId: "1", replicaName: "Primary" },
                { replicaGroupId: "2", replicaName: "Secondary" },
            ],
        });
        assertReadBatches(reader, info);
    });

    test("probeQueryStore reports OFF as notConfigured with data", async () => {
        const reader = scriptedReader([probe({ state: 0, metrics: allMetrics })]);
        const result = await perf.probeQueryStore(reader, info, options);
        assert.equal(result.status, "notConfigured");
        assert.equal(result.data.operationalStatus, "off");
        assert.equal(reader.calls.length, 1);
    });

    test("a metric that the server does not record is unsupported", async () => {
        const sql2016 = platforms.sql2016;
        for (const [run, config] of [
            [perf.runTopResourceConsumersSummary, { selectedMetric: "logMemoryUsed" }],
            [perf.runHighVariationSummary, { selectedMetric: "waitTime" }],
            [perf.runPlanSummaryGrid, { queryId: 1, selectedMetric: "tempDbMemoryUsed" }],
            [perf.runWaitStatsByCategory, {}],
            [perf.runQueryWaitCategories, { queryId: 1 }],
            [perf.runOverallResourceConsumption, { selectedMetrics: ["waitTime"] }],
        ]) {
            const reader = scriptedReader([probe({ metrics: sql2016Metrics })]);
            const result = await run(reader, sql2016, config, options);
            assert.equal(result.status, "unsupported", run.name);
            assert.equal(reader.calls.length, 1, run.name);
        }
    });

    test("a sort column of a metric that the server does not record is unsupported", async () => {
        const reader = scriptedReader([probe({ metrics: sql2016Metrics })]);
        const result = await perf.runTopResourceConsumersDetailedSummary(
            reader,
            platforms.sql2016,
            { orderByColumnId: "total_log_bytes_used" },
            options,
        );
        assert.equal(result.status, "unsupported");
    });

    test("a configuration that is not valid throws before it reads", async () => {
        const reader = scriptedReader([]);
        await assert.rejects(
            perf.runTopResourceConsumersSummary(reader, info, { orderByColumnId: "nope" }, options),
            RangeError,
        );
        await assert.rejects(
            perf.runTopResourceConsumersDetailedSummary(
                reader,
                info,
                { orderByColumnId: "nope" },
                options,
            ),
            RangeError,
        );
        await assert.rejects(
            perf.runRegressedQueriesSummary(reader, info, { topQueriesReturned: 1.5 }, options),
            RangeError,
        );
        await assert.rejects(perf.runPlanXml(reader, info, { planId: "1; DROP" }), RangeError);
        assert.equal(reader.calls.length, 0);
    });

    test("SQL Server 2016 detailed reports report the missing metrics", async () => {
        const sql2016 = platforms.sql2016;
        const { columns } = perf.topResourceConsumersDetailedSummary(sql2016Metrics, {});
        const reader = scriptedReader([probe({ metrics: sql2016Metrics }), [reportSet(columns)]]);
        const result = await perf.runTopResourceConsumersDetailedSummary(
            reader,
            sql2016,
            {},
            options,
        );
        assert.equal(result.status, "noData");
        assert.deepEqual(result.missing, ["queryStoreWaitStats", "queryStoreLogAndTempdbMetrics"]);
        assert.equal(result.data.rows.length, 0);
        assert.equal(result.data.columns.length, columns.length);
    });
});

suite("Query Store run functions: replica groups", () => {
    const info = platforms.sql2022;

    test("a secondary replica group needs Query Store for secondary replicas", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics, replicaColumn: false })]);
        const result = await perf.runTopResourceConsumersSummary(
            reader,
            info,
            { replicaGroupId: 2 },
            options,
        );
        assert.equal(result.status, "unsupported");
        assert.equal(reader.calls.length, 1);
    });

    test("filters by the replica group when the server has replicas", async () => {
        const { columns } = perf.topResourceConsumersSummary({});
        const reader = scriptedReader([
            probe({ metrics: allMetrics, replicaColumn: true }),
            [reportSet(columns)],
        ]);
        const result = await perf.runTopResourceConsumersSummary(
            reader,
            info,
            { replicaGroupId: 2, isQdsRoAvailable: false },
            options,
        );
        assert.equal(result.status, "noData");
        assert.match(reader.calls[1], /DECLARE @replica_group_id BIGINT = 2;/);
        assert.match(reader.calls[1], /AND rs\.replica_group_id = @replica_group_id/);
    });

    test("the execution count grid of a secondary replica is unsupported", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics, replicaColumn: true })]);
        const result = await perf.runPlanSummaryGrid(
            reader,
            info,
            { queryId: 1, selectedMetric: "executionCount", replicaGroupId: 2 },
            options,
        );
        assert.equal(result.status, "unsupported");
    });
});

suite("Query Store run functions: rows", () => {
    const info = platforms.azureSql;

    test("Top Resource Consumers keeps the generated SQL and normalizes the values", async () => {
        const { columns } = perf.topResourceConsumersSummary({});
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [
                reportSet(columns, [
                    ["9007199254740993", 0, "", "SELECT 1", "1234.5", "42", 2],
                    [5, 1013578649, "dbo.GetOrders", "SELECT 2", 10.25, 3, 1],
                ]),
            ],
        ]);
        const result = await perf.runTopResourceConsumersSummary(reader, info, {}, options);

        assert.equal(result.status, "ready");
        assert.equal(
            reader.calls[1],
            `${sessionPreamble(info, "read")}\n${perf.getTopResourceConsumersSummaryReportQuery(
                { isQdsRoAvailable: false },
                "total_duration",
                true,
                now,
            )}`,
        );
        assert.match(reader.calls[1], /ORDER BY total_duration DESC$/);
        assert.deepEqual(result.data.columns, [
            { id: "query_id", kind: "queryId", valueType: "id" },
            { id: "object_id", kind: "objectId", valueType: "id" },
            { id: "object_name", kind: "objectName", valueType: "text" },
            { id: "query_sql_text", kind: "queryText", valueType: "text" },
            {
                id: "total_duration",
                kind: "statisticMetric",
                valueType: "number",
                metric: "duration",
                statistic: "total",
                unit: "millisecond",
            },
            {
                id: "count_executions",
                kind: "executionCount",
                valueType: "number",
                metric: "executionCount",
            },
            { id: "num_plans", kind: "numPlans", valueType: "number" },
        ]);
        assert.deepEqual(result.data.rows, [
            {
                query_id: "9007199254740993",
                object_id: "0",
                object_name: "",
                query_sql_text: "SELECT 1",
                total_duration: 1234.5,
                count_executions: 42,
                num_plans: 2,
            },
            {
                query_id: "5",
                object_id: "1013578649",
                object_name: "dbo.GetOrders",
                query_sql_text: "SELECT 2",
                total_duration: 10.25,
                count_executions: 3,
                num_plans: 1,
            },
        ]);
        assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    });

    test("Top Resource Consumers sorts by a requested column", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics }), [resultSet(["query_id"])]]);
        await perf.runTopResourceConsumersSummary(
            reader,
            info,
            { orderByColumnId: "count_executions", descending: false },
            options,
        );
        assert.match(reader.calls[1], /ORDER BY count_executions ASC$/);
    });

    test("detailed Top Resource Consumers has every metric", async () => {
        const { columns } = perf.topResourceConsumersDetailedSummary(allMetrics, {});
        const reader = scriptedReader([probe({ metrics: allMetrics }), [reportSet(columns)]]);
        const result = await perf.runTopResourceConsumersDetailedSummary(reader, info, {}, options);
        assert.equal(result.status, "noData");
        assert.deepEqual(result.missing, []);
        assert.match(reader.calls[1], /ORDER BY total_duration DESC$/);
        const logBytes = perf.findReportColumn(result.data.columns, { metric: "logMemoryUsed" });
        assert.deepEqual(logBytes, {
            id: "total_log_bytes_used",
            kind: "statisticMetric",
            valueType: "number",
            metric: "logMemoryUsed",
            statistic: "total",
            unit: "kilobyte",
        });
    });

    test("High Variation sorts by the variation and has no unit for it", async () => {
        const { columns } = perf.highVariationSummary({});
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [reportSet(columns, [[1, 0, "", "SELECT 1", 5, 2, 1.5, 9, 2]])],
        ]);
        const result = await perf.runHighVariationSummary(reader, info, {}, options);
        assert.equal(result.status, "ready");
        assert.match(reader.calls[1], /ORDER BY variation_duration DESC$/);
        const variation = perf.findReportColumn(result.data.columns, { statistic: "variation" });
        assert.equal(variation.unit, undefined);
        assert.equal(result.data.rows[0].variation_duration, 1.5);
    });

    test("detailed High Variation runs with the available metrics", async () => {
        const { columns } = perf.highVariationDetailedSummary(allMetrics, {});
        const reader = scriptedReader([probe({ metrics: allMetrics }), [reportSet(columns)]]);
        const result = await perf.runHighVariationDetailedSummary(reader, info, {}, options);
        assert.equal(result.status, "noData");
        assert.match(reader.calls[1], /ORDER BY variation_duration DESC$/);
    });

    test("Overall Resource Consumption sorts the buckets in time order", async () => {
        const { columns } = perf.overallResourceConsumption(allMetrics, {}, undefined, true, now);
        const row = columns.map((column) =>
            column.kind === "bucketStartTime"
                ? "2026-10-07 05:00:00.0000000 +00:00"
                : column.kind === "bucketEndTime"
                  ? "2026-10-07T06:00:00Z"
                  : "1.5",
        );
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [reportSet(columns, [row])],
        ]);
        const result = await perf.runOverallResourceConsumption(reader, info, {}, options);

        assert.equal(result.status, "ready");
        const declarations = perf
            .getOverallResourceConsumptionReportQuery({}, allMetrics, now)
            .split("\n\n")[0];
        assert.ok(reader.calls[1].includes(`${declarations}\n\nWITH DateGenerator AS`));
        assert.match(reader.calls[1], /\nORDER BY bucket_start ASC\nOPTION \(MAXRECURSION 0\)$/);
        assert.equal(result.data.rows[0].bucket_start, "2026-10-07T05:00:00.000Z");
        assert.equal(result.data.rows[0].bucket_end, "2026-10-07T06:00:00.000Z");
        assert.equal(result.data.rows[0].total_duration, 1.5);
    });

    test("Overall Resource Consumption reads all time from the oldest interval", async () => {
        const { columns } = perf.overallResourceConsumption(allMetrics, {}, undefined, true, now);
        const reader = scriptedReader([
            probe({ metrics: allMetrics, oldestInterval: "2026-09-01 10:00:00.0000000 +00:00" }),
            [reportSet(columns)],
        ]);
        const config = { specifiedTimeInterval: { option: "allTime" } };
        const result = await perf.runOverallResourceConsumption(reader, info, config, options);

        assert.equal(result.status, "noData");
        assert.match(
            reader.calls[0],
            /SELECT MIN\(start_time\) AS oldest_interval_start\nFROM sys\.query_store_runtime_stats_interval;$/,
        );
        const declarations = perf
            .getOverallResourceConsumptionReportQuery(
                {
                    specifiedTimeInterval: {
                        start: new Date(Date.UTC(2026, 8, 1, 10)),
                        end: now,
                    },
                },
                allMetrics,
                now,
            )
            .split("\n\n")[0];
        assert.ok(reader.calls[1].includes(`${declarations}\n\nWITH DateGenerator AS`));
        assert.match(
            reader.calls[1],
            /DECLARE @interval_start_time DATETIMEOFFSET = '2026-09-01T10:00:00\.0000000\+00:00';/,
        );
        assert.doesNotMatch(reader.calls[1], /0001-01-01/);
    });

    test("Overall Resource Consumption returns no data when Query Store has no interval", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics, oldestInterval: null })]);
        const config = { specifiedTimeInterval: { option: "allTime" } };
        const result = await perf.runOverallResourceConsumption(reader, info, config, options);

        assert.equal(result.status, "noData");
        assert.equal(reader.calls.length, 1);
        assert.deepEqual(result.data.rows, []);
        assert.ok(result.data.columns.some((column) => column.id === "bucket_start"));
    });

    test("Overall Resource Consumption reads the oldest interval only for an early start", async () => {
        const { columns } = perf.overallResourceConsumption(allMetrics, {}, undefined, true, now);
        for (const config of [{}, { specifiedTimeInterval: { option: "lastYear" } }]) {
            const reader = scriptedReader([probe({ metrics: allMetrics }), [reportSet(columns)]]);
            await perf.runOverallResourceConsumption(reader, info, config, options);
            assert.doesNotMatch(reader.calls[0], /oldest_interval_start/);
        }
    });

    test("Forced Plans maps the two last execution times and sorts by either one", async () => {
        const { columns } = perf.forcedPlanQueriesSummary({});
        const row = [
            "12",
            "SELECT 1",
            "34",
            "1",
            "2026-10-08 05:00:00.1234567 +02:00",
            "NO_INDEX",
            "3",
            "2026-10-08T05:30:00.000+00:00",
            "2026-10-08 04:00:00",
            0,
            "",
        ];
        const reader = scriptedReader([probe(), [reportSet(columns, [row])]]);
        const result = await perf.runForcedPlanQueries(
            reader,
            info,
            { orderByColumnId: "last_forced_plan_exec_time" },
            options,
        );
        assert.equal(result.status, "ready");
        assert.deepEqual(
            result.data.columns.map((column) => column.id),
            [
                "query_id",
                "query_sql_text",
                "plan_id",
                "force_failure_count",
                "last_compile_start_time",
                "last_force_failure_reason_desc",
                "num_plans",
                "last_execution_time",
                "last_forced_plan_exec_time",
                "object_id",
                "object_name",
            ],
        );
        assert.deepEqual(result.data.rows[0], {
            query_id: "12",
            query_sql_text: "SELECT 1",
            plan_id: "34",
            force_failure_count: 1,
            last_compile_start_time: "2026-10-08T03:00:00.123Z",
            last_force_failure_reason_desc: "NO_INDEX",
            num_plans: 3,
            last_execution_time: "2026-10-08T05:30:00.000Z",
            last_forced_plan_exec_time: "2026-10-08T04:00:00.000Z",
            object_id: "0",
            object_name: "",
        });
        assert.match(reader.calls[1], /ORDER BY A\.last_execution_time DESC$/);
        // Forced Plans does not need the metrics.
        assert.doesNotMatch(reader.calls[0], /query_store_runtime_stats;/);
    });

    test("Forced Plans keeps the generator's query for its default order", async () => {
        const reader = scriptedReader([probe(), [resultSet(["query_id"])]]);
        await perf.runForcedPlanQueries(reader, info, {}, options);
        assert.equal(
            reader.calls[1],
            `${sessionPreamble(info, "read")}\n${perf.getForcedPlanQueriesReportQuery({})}`,
        );
    });

    test("Tracked Queries maps the search result", async () => {
        const reader = scriptedReader([
            probe(),
            [resultSet(["query_id", "query_text_id", "query_sql_text"], [[5, "6", "SELECT 'x'"]])],
        ]);
        const result = await perf.runTrackedQueries(
            reader,
            info,
            { querySearchText: "it's" },
            options,
        );
        assert.match(reader.calls[1], /DECLARE @QuerySearchText NVARCHAR\(max\) = N'it''s';/);
        assert.deepEqual(result.data.rows, [
            { query_id: "5", query_text_id: "6", query_sql_text: "SELECT 'x'" },
        ]);
        assert.equal(result.data.columns[1].kind, "queryTextId");
    });

    test("the plan summary chart and grid map forced plans and times", async () => {
        const chartColumns = perf.planSummaryChartView({ queryId: 7 }, "hour").columns;
        const chart = scriptedReader([
            probe({ metrics: allMetrics }),
            [
                reportSet(chartColumns, [
                    [
                        "9",
                        true,
                        0,
                        "4",
                        "2026-10-08 05:00:00 +00:00",
                        "2026-10-08 06:00:00 +00:00",
                        1,
                        2,
                        0.5,
                        0.1,
                        0.2,
                        4,
                    ],
                ]),
            ],
        ]);
        const chartResult = await perf.runPlanSummaryChart(chart, info, { queryId: 7 }, options);
        assert.equal(chartResult.status, "ready");
        assert.equal(
            chart.calls[1],
            `${sessionPreamble(info, "read")}\n${perf.getPlanSummaryChartViewQuery(
                { queryId: 7 },
                now,
            )}`,
        );
        assert.equal(chartResult.data.rows[0].is_forced_plan, true);
        assert.equal(chartResult.data.rows[0].bucket_start, "2026-10-08T05:00:00.000Z");

        const gridColumns = perf.planSummaryGridView({ queryId: 7 }).columns;
        const grid = scriptedReader([
            probe({ metrics: allMetrics }),
            [reportSet(gridColumns, [["9", 0, 3, 4, 1, 2, 1.5, 0.1, 0.2, 1, 6, null, null]])],
        ]);
        const gridResult = await perf.runPlanSummaryGrid(grid, info, { queryId: 7 }, options);
        assert.equal(gridResult.status, "ready");
        assert.equal(gridResult.data.rows[0].is_forced_plan, false);
        assert.equal(gridResult.data.rows[0].execution_type, 3);
        assert.equal(gridResult.data.rows[0].first_execution_time, null);
        assert.match(grid.calls[1], /ORDER BY plan_id DESC$/);
    });

    test("wait stats by category and by query sort by the total", async () => {
        const categoryColumns = perf.aggWaitTimePerWaitCategory({}).columns;
        const byCategory = scriptedReader([
            probe({ metrics: allMetrics }),
            [reportSet(categoryColumns, [[3, "Lock", 1, 0, 5, 2, 50, "10"]])],
        ]);
        const categoryResult = await perf.runWaitStatsByCategory(byCategory, info, {}, options);
        assert.equal(categoryResult.status, "ready");
        assert.match(byCategory.calls[1], /ORDER BY total_query_wait_time DESC$/);
        assert.equal(categoryResult.data.rows[0].wait_category, 3);
        assert.equal(categoryResult.data.rows[0].count_executions, 10);

        const queryColumns = perf.aggWaitTimePerQueryForWaitCategoryId({}).columns;
        const byQuery = scriptedReader([probe({ metrics: allMetrics }), [reportSet(queryColumns)]]);
        const queryResult = await perf.runWaitStatsQueriesForCategory(
            byQuery,
            info,
            { waitCategoryId: 3 },
            options,
        );
        assert.equal(queryResult.status, "noData");
        assert.match(byQuery.calls[1], /DECLARE @wait_category INT = 3;/);
        assert.match(byQuery.calls[1], /ORDER BY total_query_wait_time DESC$/);
    });

    test("the wait categories of a query", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [resultSet(["WaitCategory", "WaitTime"], [["Lock", "120.5"]])],
        ]);
        const result = await perf.runQueryWaitCategories(reader, info, { queryId: 7 }, options);
        assert.equal(result.status, "ready");
        assert.match(reader.calls[1], /DECLARE @query_id BIGINT = 7;/);
        assert.deepEqual(result.data.rows, [{ WaitCategory: "Lock", WaitTime: 120.5 }]);
        assert.equal(result.data.columns[1].unit, "millisecond");
    });

    test("the query text of a query outside a module", async () => {
        const reader = scriptedReader([
            probe(),
            [resultSet(["object_id", "query_sql_text"], [[0, "SELECT 1"]])],
        ]);
        const result = await perf.runQueryText(reader, info, { queryId: 7 }, options);
        assert.equal(result.status, "ready");
        assert.deepEqual(result.data, { kind: "queryText", text: "SELECT 1" });
        assert.equal(reader.calls.length, 2);
        assertReadBatches(reader, info);
    });

    test("the query text of a query in a module reads the definition", async () => {
        const reader = scriptedReader([
            probe(),
            [resultSet(["object_id", "query_sql_text"], [["1013578649", "SELECT 1"]])],
            [resultSet(["definition"], [["CREATE PROCEDURE p AS\nSELECT 1"]])],
        ]);
        const result = await perf.runQueryText(reader, info, { queryId: 7 }, options);
        assert.equal(result.data.kind, "containingObject");
        assert.equal(result.data.script, "ALTER PROCEDURE p AS\nSELECT 1");
        assert.match(reader.calls[2], /DECLARE @Object_ID BIGINT = 1013578649;/);
        assertReadBatches(reader, info);
    });

    test("query text and plan XML give noData for an unknown ID", async () => {
        const text = scriptedReader([probe(), [resultSet(["object_id", "query_sql_text"])]]);
        const textResult = await perf.runQueryText(text, info, { queryId: 7 }, options);
        assert.equal(textResult.status, "noData");
        assert.equal(textResult.data, undefined);

        const plan = scriptedReader([probe(), [resultSet(["query_plan"])]]);
        assert.equal((await perf.runPlanXml(plan, info, { planId: 9 }, options)).status, "noData");
    });
});

suite("Query Store run functions: errors", () => {
    const info = platforms.azureSql;

    test("a permission error gives permissionMissing", async () => {
        const reader = scriptedReader([
            new SqlReadError("VIEW DATABASE STATE permission denied", "server", 300),
        ]);
        const result = await perf.runTopResourceConsumersSummary(reader, info, {}, options);
        assert.equal(result.status, "permissionMissing");
        assert.equal(result.source, "queryStore");
        assert.equal(result.error.errorNumber, 300);
    });

    test("a timeout of the report gives temporarilyUnavailable", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            new SqlReadError("Timed out", "timeout"),
        ]);
        const result = await perf.runHighVariationSummary(reader, info, {}, options);
        assert.equal(result.status, "temporarilyUnavailable");
    });

    test("an invalid object gives unsupported and other errors give failed", async () => {
        const missing = scriptedReader([
            probe(),
            new SqlReadError("Invalid object", "server", 208),
        ]);
        assert.equal(
            (await perf.runForcedPlanQueries(missing, info, {}, options)).status,
            "unsupported",
        );
        const other = scriptedReader([new Error("boom")]);
        const result = await perf.runPlanXml(other, info, { planId: 1 }, options);
        assert.equal(result.status, "failed");
        assert.equal(result.error.message, "boom");
    });
});

suite("Query Store run functions: values", () => {
    test("parses SQL date and time text", () => {
        const { parseSqlDateTime } = require("../dist/index.js");
        const iso = (value) => parseSqlDateTime(value)?.toISOString();
        assert.equal(iso("2026-10-08 05:00:00.1234567 +02:00"), "2026-10-08T03:00:00.123Z");
        assert.equal(iso("2026-10-08T05:00:00-0130"), "2026-10-08T06:30:00.000Z");
        assert.equal(iso("2026-10-08 05:00:00"), "2026-10-08T05:00:00.000Z");
        assert.equal(iso("2026-10-08"), "2026-10-08T00:00:00.000Z");
        assert.equal(iso("0001-01-01 00:00:00.0000000 +00:00"), "0001-01-01T00:00:00.000Z");
        assert.equal(iso("2026-02-30 00:00:00"), undefined);
        assert.equal(iso("10/08/2026"), undefined);
        assert.equal(iso(42), undefined);
    });

    test("normalizes each value type and keeps values of another type", () => {
        const { normalizeReportValue } = perf;
        assert.equal(normalizeReportValue("12345678901234567890", "id"), "12345678901234567890");
        assert.equal(normalizeReportValue(7, "id"), "7");
        assert.equal(normalizeReportValue("1.5e3", "number"), 1500);
        assert.equal(normalizeReportValue("n/a", "number"), "n/a");
        assert.equal(normalizeReportValue("1", "boolean"), true);
        assert.equal(normalizeReportValue("Tuesday", "date"), "Tuesday");
        assert.equal(normalizeReportValue(undefined, "text"), null);
        assert.equal(normalizeReportValue(3, "text"), 3);
    });

    test("a result set without a report column fails", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [resultSet(["query_id"], [[1]])],
        ]);
        const result = await perf.runTopResourceConsumersSummary(
            reader,
            platforms.azureSql,
            {},
            options,
        );
        assert.equal(result.status, "failed");
        assert.match(result.error.message, /object_id/);
    });
});
