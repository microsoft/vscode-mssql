/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError, classifyPlatform } = require("../dist/index.js");
const { buildTopQueriesPlan, getTopQueries } = require("../dist/performance/index.js");

const window = {
    start: new Date(Date.UTC(2026, 9, 8, 5, 0, 0)),
    end: new Date(Date.UTC(2026, 9, 8, 6, 0, 0)),
};
const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 5));

function scriptedReader(responses) {
    const calls = [];
    return {
        calls,
        read: async (sql) => {
            calls.push(sql);
            const response = responses.shift();
            if (response instanceof Error) {
                throw response;
            }
            return response ?? [];
        },
    };
}

const queryStoreOn = [{ columns: ["actual_state_desc"], rows: [["READ_WRITE"]] }];

suite("top queries", () => {
    test("uses Query Store waits and log columns from SQL Server 2017", () => {
        const plan = buildTopQueriesPlan(
            classifyPlatform({ engineEdition: 3, productVersion: "14.0.3465.1" }),
            { ...window, metric: "waitTime", top: 10 },
        );
        assert.equal(plan.source, "queryStore");
        assert.match(plan.sql, /sys\.query_store_wait_stats/);
        assert.match(plan.sql, /avg_log_bytes_used/);
        assert.match(plan.sql, /TOP \(10\)/);
        assert.match(plan.sql, /ORDER BY ISNULL\(w\.total_wait_ms, 0\) DESC/);
        assert.deepEqual(plan.missing, []);
    });

    test("leaves out waits and log columns on SQL Server 2016", () => {
        const sql2016 = classifyPlatform({ engineEdition: 2, productVersion: "13.0.6300.2" });
        const plan = buildTopQueriesPlan(sql2016, { ...window, metric: "cpu", top: 5 });
        assert.doesNotMatch(plan.sql, /query_store_wait_stats/);
        assert.doesNotMatch(plan.sql, /avg_log_bytes_used/);
        assert.deepEqual(plan.missing, ["queryStoreWaitStats", "queryStoreLogAndTempdbMetrics"]);
        assert.equal(
            buildTopQueriesPlan(sql2016, { ...window, metric: "waitTime", top: 5 }),
            undefined,
        );
    });

    test("reads only duration and count on Synapse dedicated pools", () => {
        const synapse = classifyPlatform({ engineEdition: 6 });
        const plan = buildTopQueriesPlan(synapse, { ...window, metric: "duration", top: 5 });
        assert.doesNotMatch(plan.sql, /avg_cpu_time/);
        assert.equal(buildTopQueriesPlan(synapse, { ...window, metric: "cpu", top: 5 }), undefined);
    });

    test("uses Query Insights on Fabric Warehouse", () => {
        const plan = buildTopQueriesPlan(
            classifyPlatform({ engineEdition: 11, dataLakeLogPublishing: "AUTO" }),
            { ...window, metric: "cpu", top: 5 },
        );
        assert.equal(plan.source, "queryInsights");
        assert.match(plan.sql, /queryinsights\.exec_requests_history/);
        assert.match(plan.sql, /AS datetime2/);
        assert.equal(plan.checkQueryStoreState, false);
    });

    test("rejects an empty window", () => {
        assert.throws(
            () =>
                buildTopQueriesPlan(classifyPlatform({ engineEdition: 5 }), {
                    start: window.end,
                    end: window.start,
                    metric: "cpu",
                    top: 5,
                }),
            RangeError,
        );
    });

    test("returns unsupported for Synapse serverless", async () => {
        const reader = scriptedReader([]);
        const result = await getTopQueries(
            reader,
            classifyPlatform({ engineEdition: 11 }),
            { ...window, metric: "cpu", top: 5 },
            undefined,
            now,
        );
        assert.equal(result.status, "unsupported");
        assert.equal(reader.calls.length, 0);
    });

    test("returns notConfigured when Query Store is off", async () => {
        const reader = scriptedReader([[{ columns: ["actual_state_desc"], rows: [["OFF"]] }]]);
        const result = await getTopQueries(
            reader,
            classifyPlatform({ engineEdition: 5 }),
            { ...window, metric: "cpu", top: 5 },
            undefined,
            now,
        );
        assert.equal(result.status, "notConfigured");
        assert.equal(reader.calls.length, 1);
    });

    test("converts Query Store units and keeps large IDs exact", async () => {
        const reader = scriptedReader([
            queryStoreOn,
            [
                {
                    columns: [
                        "query_id",
                        "query_hash",
                        "object_name",
                        "text_preview",
                        "executions",
                        "total_cpu_us",
                        "total_duration_us",
                        "total_memory_pages",
                        "total_tempdb_pages",
                        "plan_count",
                    ],
                    rows: [
                        [
                            "9007199254740993",
                            "0x1A2B",
                            "dbo.GetOrders",
                            "SELECT 1",
                            4,
                            2500,
                            10000,
                            16,
                            3,
                            2,
                        ],
                    ],
                },
            ],
        ]);
        const result = await getTopQueries(
            reader,
            classifyPlatform({ engineEdition: 5 }),
            { ...window, metric: "cpu", top: 5 },
            undefined,
            now,
        );
        assert.equal(result.status, "ready");
        assert.equal(result.source, "queryStore");
        assert.equal(result.observedAtUtc, now.toISOString());
        const [query] = result.data;
        assert.equal(query.queryId, "9007199254740993");
        assert.equal(query.totalCpuMs, 2.5);
        assert.equal(query.totalDurationMs, 10);
        assert.equal(query.totalMemoryKb, 128);
        assert.equal(query.totalTempdbKb, 24);
        assert.equal(query.planCount, 2);
    });

    test("returns noData when the window has no queries", async () => {
        const reader = scriptedReader([queryStoreOn, [{ columns: ["query_id"], rows: [] }]]);
        const result = await getTopQueries(
            reader,
            classifyPlatform({ engineEdition: 8 }),
            { ...window, metric: "duration", top: 5 },
            undefined,
            now,
        );
        assert.equal(result.status, "noData");
        assert.deepEqual(result.data, []);
    });

    test("maps a permission error to permissionMissing", async () => {
        const reader = scriptedReader([
            new SqlReadError("VIEW DATABASE STATE permission denied", "server", 300),
        ]);
        const result = await getTopQueries(
            reader,
            classifyPlatform({ engineEdition: 5 }),
            { ...window, metric: "cpu", top: 5 },
            undefined,
            now,
        );
        assert.equal(result.status, "permissionMissing");
        assert.equal(result.error.errorNumber, 300);
    });

    test("maps a timeout to temporarilyUnavailable", async () => {
        const reader = scriptedReader([new SqlReadError("Timed out", "timeout")]);
        const result = await getTopQueries(
            reader,
            classifyPlatform({ engineEdition: 5 }),
            { ...window, metric: "cpu", top: 5 },
            undefined,
            now,
        );
        assert.equal(result.status, "temporarilyUnavailable");
    });
});
