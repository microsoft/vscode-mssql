/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { buildDatabaseStorageQuery, readDatabaseStorage } = require("../dist/performance/index.js");
const { platforms, resultSet, scriptedReader } = require("../test-fixtures/fakeReader.js");

suite("database storage", () => {
    test("queries all user tables, including tables without partition stats", () => {
        const sql = buildDatabaseStorageQuery(platforms.sql2022);

        assert.match(sql, /FROM sys\.tables AS t/);
        assert.match(sql, /LEFT JOIN sys\.dm_db_partition_stats AS ps/);
        assert.doesNotMatch(sql, /SELECT TOP/);
    });

    test("returns more than 100 tables and preserves zero-size tables", async () => {
        const rows = Array.from({ length: 125 }, (_, index) => [
            "sales",
            `Table${index}`,
            index,
            index * 8,
            index * 8,
        ]);
        rows.push(["sales", "Empty", 0, 0, 0]);
        const reader = scriptedReader([
            [
                resultSet(
                    ["allocated_pages", "used_pages", "max_size_bytes"],
                    [[8192, 4096, null]],
                ),
                resultSet(
                    ["schema_name", "table_name", "row_count", "used_pages", "reserved_pages"],
                    rows,
                ),
            ],
        ]);

        const result = await readDatabaseStorage(reader, platforms.sql2022);

        assert.equal(result.status, "ready");
        assert.equal(result.data.tables.length, 126);
        assert.deepEqual(result.data.tables.at(-1), {
            schemaName: "sales",
            tableName: "Empty",
            rowCount: 0,
            usedMb: 0,
            reservedMb: 0,
        });
    });
});
