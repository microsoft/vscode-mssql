/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { sessionPreamble } = require("../dist/index.js");
const perf = require("../dist/performance/index.js");
const {
    allMetrics,
    platforms,
    probe,
    resultSet,
    scriptedReader,
} = require("../test-fixtures/fakeReader.js");

const now = new Date(Date.UTC(2026, 9, 8, 6));
const options = { now };
const info = platforms.sql2022;
const hourMs = 60 * 60 * 1000;
const last24Hours = { start: new Date(now.getTime() - 24 * hourMs), end: now };
const previous24Hours = { start: new Date(now.getTime() - 48 * hourMs), end: last24Hours.start };
const totalColumns = ["total_0", "executions_0", "total_1", "executions_1"];

suite("Query Store metric totals", () => {
    test("totals CPU time for each window", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [resultSet(totalColumns, [[3600000, 1200, 1800000, "900"]])],
        ]);
        const result = await perf.runQueryStoreMetricTotals(
            reader,
            info,
            { metric: "cpuTime", windows: [last24Hours, previous24Hours] },
            options,
        );

        assert.equal(result.status, "ready");
        assert.deepEqual(result.data, {
            metric: "cpuTime",
            windows: [
                {
                    startUtc: "2026-10-07T06:00:00.000Z",
                    endUtc: "2026-10-08T06:00:00.000Z",
                    total: 3600000,
                    executionCount: 1200,
                },
                {
                    startUtc: "2026-10-06T06:00:00.000Z",
                    endUtc: "2026-10-07T06:00:00.000Z",
                    total: 1800000,
                    executionCount: 900,
                },
            ],
        });
        const sql = reader.calls[1];
        assert.ok(sql.startsWith(sessionPreamble(info, "read")));
        assert.match(
            sql,
            /DECLARE @window_0_start DATETIMEOFFSET = '2026-10-07T06:00:00\.0000000\+00:00';/,
        );
        assert.match(
            sql,
            /DECLARE @range_start DATETIMEOFFSET = '2026-10-06T06:00:00\.0000000\+00:00';/,
        );
        assert.match(
            sql,
            /CONVERT\(float, SUM\(CASE WHEN rsi\.start_time >= @window_1_start AND rsi\.start_time < @window_1_end THEN rs\.avg_cpu_time \* rs\.count_executions ELSE 0 END\)\) \* 0\.001 AS total_1/,
        );
        assert.doesNotMatch(sql, /replica_group_id/);
        assert.doesNotMatch(sql, /MAXDOP/);
    });

    test("returns noData with zero totals when nothing ran", async () => {
        const reader = scriptedReader([
            probe({ metrics: allMetrics }),
            [resultSet(totalColumns, [[null, null, null, null]])],
        ]);
        const result = await perf.runQueryStoreMetricTotals(
            reader,
            info,
            { metric: "cpuTime", windows: [last24Hours, previous24Hours] },
            options,
        );

        assert.equal(result.status, "noData");
        assert.deepEqual(
            result.data.windows.map((window) => [window.total, window.executionCount]),
            [
                [0, 0],
                [0, 0],
            ],
        );
    });

    test("is unsupported when the server does not record the metric", async () => {
        const reader = scriptedReader([probe({ metrics: allMetrics })]);
        const result = await perf.runQueryStoreMetricTotals(
            reader,
            platforms.synapseDedicated,
            { metric: "cpuTime", windows: [last24Hours] },
            options,
        );

        assert.equal(result.status, "unsupported");
        assert.equal(reader.calls.length, 1);
    });

    test("filters by the replica group with Query Store for secondary replicas", () => {
        const sql = perf.buildMetricTotalsQuery("duration", [last24Hours], "1");

        assert.match(sql, /DECLARE @replica_group_id BIGINT = 1;/);
        assert.match(sql, /AND rs\.replica_group_id = @replica_group_id;$/);
        assert.match(sql, /rs\.avg_duration \* rs\.count_executions/);
    });

    test("counts executions without a conversion", () => {
        const sql = perf.buildMetricTotalsQuery("executionCount", [last24Hours]);

        assert.match(sql, /THEN rs\.count_executions ELSE 0 END\)\) \* 1 AS total_0/);
    });

    test("rejects windows that are not valid", async () => {
        const reader = scriptedReader([]);
        const run = (config) => perf.runQueryStoreMetricTotals(reader, info, config, options);

        await assert.rejects(run({ metric: "cpuTime", windows: [] }), RangeError);
        await assert.rejects(
            run({ metric: "cpuTime", windows: [{ start: now, end: now }] }),
            RangeError,
        );
        await assert.rejects(run({ metric: "waitTime", windows: [last24Hours] }), RangeError);
        assert.equal(reader.calls.length, 0);
    });
});
