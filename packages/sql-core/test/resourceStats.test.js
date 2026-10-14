/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    buildDatabaseResourceCpuQuery,
    buildServerResourceCpuQuery,
} = require("../dist/performance/index.js");
const { platforms } = require("../test-fixtures/fakeReader.js");

suite("resource stats", () => {
    test("reads master.sys.resource_stats without a memory column, which it does not have", () => {
        const sql = buildServerResourceCpuQuery(platforms.azureSql, {
            databaseName: "Sales",
            start: new Date("2026-10-01T00:00:00Z"),
            end: new Date("2026-10-02T00:00:00Z"),
        });

        assert.match(sql, /FROM sys\.resource_stats/);
        assert.match(sql, /storage_in_megabytes/);
        assert.doesNotMatch(sql, /avg_memory_usage_percent/);
    });

    test("reads the memory percent from sys.dm_db_resource_stats", () => {
        const sql = buildDatabaseResourceCpuQuery(platforms.azureSql);

        assert.match(sql, /avg_memory_usage_percent\s+FROM sys\.dm_db_resource_stats/);
    });
});
