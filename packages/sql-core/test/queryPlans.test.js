/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { buildQueryPlansQuery, resolveQueryWindow } = require("../dist/performance/index.js");

suite("query plans", () => {
    test("reads the CPU time and the memory grants of each plan in the window", () => {
        const target = resolveQueryWindow({
            queryId: "42",
            start: new Date("2026-10-01T00:00:00Z"),
            end: new Date("2026-10-02T00:00:00Z"),
        });
        const sql = buildQueryPlansQuery(
            target,
            { hasPlanForcingType: true, hasPlanType: true },
            false,
        );

        assert.match(sql, /AS total_cpu_ms/);
        // avg_query_max_used_memory is in 8 KB pages.
        assert.match(
            sql,
            /SUM\(rs\.avg_query_max_used_memory \* rs\.count_executions\)\) \* 8 AS total_memory_kb/,
        );
        assert.match(sql, /w\.total_memory_kb/);
    });
});
