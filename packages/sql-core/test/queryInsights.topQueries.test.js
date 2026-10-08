/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError } = require("../dist/index.js");
const {
    buildQueryInsightsTopQueriesQuery,
    runQueryInsightsTopQueries,
} = require("../dist/performance/index.js");
const { platforms, resultSet, scriptedReader } = require("../test-fixtures/fakeReader.js");

const window = {
    start: new Date(Date.UTC(2026, 9, 8, 5, 0, 0)),
    end: new Date(Date.UTC(2026, 9, 8, 6, 0, 0)),
};
const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 5));
const request = { ...window, metric: "cpu", top: 5 };

suite("Query Insights top queries", () => {
    test("reads Query Insights with UTC datetime2 bounds", () => {
        const sql = buildQueryInsightsTopQueriesQuery(platforms.fabricWarehouse, {
            ...request,
            metric: "dataScanned",
            top: 10,
        });
        assert.match(sql, /queryinsights\.exec_requests_history/);
        assert.match(
            sql,
            /DECLARE @start datetime2 = CAST\(N'2026-10-08T05:00:00\.000' AS datetime2\);/,
        );
        assert.match(sql, /TOP \(10\)/);
        assert.match(sql, /ORDER BY total_data_scanned_mb DESC;/);
        assert.match(sql, /^\nSET NOCOUNT ON;\n/);
    });

    test("rejects an empty window, a row count out of range, and an unknown metric", () => {
        const info = platforms.fabricWarehouse;
        assert.throws(
            () =>
                buildQueryInsightsTopQueriesQuery(info, {
                    ...request,
                    start: window.end,
                    end: window.start,
                }),
            RangeError,
        );
        assert.throws(
            () => buildQueryInsightsTopQueriesQuery(info, { ...request, top: 0 }),
            RangeError,
        );
        assert.throws(
            () => buildQueryInsightsTopQueriesQuery(info, { ...request, metric: "logicalReads" }),
            RangeError,
        );
    });

    test("is unsupported outside Fabric Data Warehouse and the SQL analytics endpoint", async () => {
        for (const platform of ["synapseServerless", "synapseDedicated", "azureSql", "sql2022"]) {
            const reader = scriptedReader([]);
            const result = await runQueryInsightsTopQueries(reader, platforms[platform], request, {
                now,
            });
            assert.equal(result.status, "unsupported", platform);
            assert.equal(reader.calls.length, 0);
        }
    });

    test("maps the rows with ISO times", async () => {
        const reader = scriptedReader([
            [
                resultSet(
                    [
                        "query_hash",
                        "executions",
                        "failed_executions",
                        "total_duration_ms",
                        "total_cpu_ms",
                        "total_data_scanned_mb",
                        "last_execution_time",
                        "text_preview",
                    ],
                    [
                        [
                            "0x1A2B",
                            4,
                            1,
                            "1200",
                            300,
                            12.5,
                            "2026-10-08 05:59:00.1230000",
                            "SELECT 1",
                        ],
                    ],
                ),
            ],
        ]);
        const result = await runQueryInsightsTopQueries(
            reader,
            platforms.sqlAnalyticsEndpoint,
            request,
            { now },
        );
        assert.equal(result.status, "ready");
        assert.equal(result.source, "queryInsights");
        assert.equal(result.scope, "item");
        assert.equal(result.observedAtUtc, now.toISOString());
        assert.deepEqual(result.data, [
            {
                queryHash: "0x1A2B",
                textPreview: "SELECT 1",
                executions: 4,
                failedExecutions: 1,
                lastExecutionTime: "2026-10-08T05:59:00.123Z",
                totalCpuMs: 300,
                totalDurationMs: 1200,
                totalDataScannedMb: 12.5,
            },
        ]);
    });

    test("returns noData when the window has no queries", async () => {
        const reader = scriptedReader([[resultSet(["query_hash"])]]);
        const result = await runQueryInsightsTopQueries(
            reader,
            platforms.fabricWarehouse,
            request,
            {
                now,
            },
        );
        assert.equal(result.status, "noData");
        assert.deepEqual(result.data, []);
    });

    test("maps a permission error and a timeout", async () => {
        const denied = scriptedReader([new SqlReadError("denied", "server", 229)]);
        const deniedResult = await runQueryInsightsTopQueries(
            denied,
            platforms.fabricWarehouse,
            request,
            { now },
        );
        assert.equal(deniedResult.status, "permissionMissing");
        assert.equal(deniedResult.error.errorNumber, 229);

        const timeout = scriptedReader([new SqlReadError("Timed out", "timeout")]);
        const timeoutResult = await runQueryInsightsTopQueries(
            timeout,
            platforms.fabricWarehouse,
            request,
            { now },
        );
        assert.equal(timeoutResult.status, "temporarilyUnavailable");
    });
});
