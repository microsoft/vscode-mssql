/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { SqlExecutionError } from "../../src/core/execution";
import { SqlEditError } from "../../src/edit/core/sql";
import { SqlRunner } from "../../src/edit/core/types";
import { EditSession } from "../../src/edit/session/editSession";

void test("edit commits retain unknown outcomes instead of claiming rollback", async () => {
    const runner: SqlRunner = {
        async query(_sql, options) {
            switch (options?.tag) {
                case "sqlEdit.columns":
                    return {
                        columns: [],
                        rows: [{ column_name: "Id", type_name: "int", is_nullable: false }],
                    };
                case "sqlEdit.indexes":
                    return {
                        columns: [],
                        rows: [
                            {
                                index_name: "PK",
                                column_name: "Id",
                                is_primary_key: true,
                                is_unique: true,
                                is_nullable: false,
                            },
                        ],
                    };
                case "sqlEdit.commit":
                    throw new SqlExecutionError("Connection lost", "connectionLost", "unknown");
                default:
                    return { columns: [], rows: [] };
            }
        },
    };
    const session = await EditSession.open(runner, "dbo", "T");
    await assert.rejects(
        session.commit([{ kind: "insert", rowId: 1, values: { Id: "1" } }]),
        (error: unknown) =>
            error instanceof SqlExecutionError &&
            error.outcomeCertainty === "unknown" &&
            error.message.includes("may have been applied") &&
            !error.message.includes("nothing was applied"),
    );
});

void test("an acknowledged commit exposes returned keys for server-generated values", async () => {
    const runner: SqlRunner = {
        async query(_sql, options) {
            switch (options?.tag) {
                case "sqlEdit.columns":
                    return {
                        columns: [],
                        rows: [{ column_name: "Id", type_name: "int", is_nullable: false }],
                    };
                case "sqlEdit.indexes":
                    return {
                        columns: [],
                        rows: [
                            {
                                index_name: "PK",
                                column_name: "Id",
                                is_primary_key: true,
                                is_unique: true,
                                is_nullable: false,
                            },
                        ],
                    };
                case "sqlEdit.commit":
                    return {
                        columns: [],
                        rows: [
                            {
                                __sql_edit_row_id: "4",
                                __sql_edit_kind: "insert",
                                __sql_edit_key_0: "27",
                            },
                        ],
                    };
                default:
                    return { columns: [], rows: [] };
            }
        },
    };
    const session = await EditSession.open(runner, "dbo", "T");
    const result = await session.commit([{ kind: "insert", rowId: 4, values: { Id: "27" } }]);
    assert.deepEqual(result.observations, [{ rowId: 4, kind: "insert", key: { Id: "27" } }]);
});

void test("incomplete page cells stay marked and a still-truncated full read is rejected", async () => {
    const runner: SqlRunner = {
        async query(_sql, options) {
            switch (options?.tag) {
                case "sqlEdit.columns":
                    return {
                        columns: [],
                        rows: [
                            {
                                column_name: "Id",
                                type_name: "int",
                                is_nullable: false,
                                is_identity: false,
                                is_computed: false,
                                has_default: false,
                                ordinal: 1,
                            },
                            {
                                column_name: "Body",
                                type_name: "nvarchar",
                                max_length: -1,
                                is_nullable: true,
                                is_identity: false,
                                is_computed: false,
                                has_default: false,
                                ordinal: 2,
                            },
                        ],
                    };
                case "sqlEdit.indexes":
                    return {
                        columns: [],
                        rows: [
                            {
                                index_name: "PK",
                                column_name: "Id",
                                is_primary_key: true,
                                is_unique: true,
                                is_nullable: false,
                            },
                        ],
                    };
                case "sqlEdit.properties":
                    return {
                        columns: [],
                        rows: [{ object_type: "user_table", is_memory_optimized: false }],
                    };
                case "sqlEdit.page":
                    return {
                        columns: [],
                        rows: [
                            {
                                Id: "1",
                                Body: { $t: "truncated", v: "prefix", bytes: 100 },
                            },
                        ],
                    };
                case "sqlEdit.cell":
                    return {
                        columns: [],
                        rows: [{ Body: { $t: "truncated", v: "still-prefix", bytes: 100 } }],
                    };
                default:
                    return { columns: [], rows: [] };
            }
        },
    };

    const session = await EditSession.open(runner, "dbo", "T");
    const page = await session.readPage({ pageSize: 10 });
    assert.deepEqual(page.rows[0].incompleteColumns, ["Body"]);
    assert.equal(page.rows[0].hasTruncatedCells, true);
    await assert.rejects(
        session.readCellValue(page.rows[0].cursor, "Body"),
        (error: unknown) =>
            error instanceof SqlEditError &&
            error.code === "incompleteValue" &&
            error.message.includes("still too large"),
    );
});

void test("readPage does not advertise a next page when the result is exactly full", async () => {
    const runner: SqlRunner = {
        async query(_sql, options) {
            switch (options?.tag) {
                case "sqlEdit.columns":
                    return {
                        columns: [],
                        rows: [
                            {
                                column_name: "Id",
                                type_name: "int",
                                is_nullable: false,
                                is_identity: true,
                                is_computed: false,
                                has_default: false,
                                ordinal: 1,
                            },
                        ],
                    };
                case "sqlEdit.indexes":
                    return {
                        columns: [],
                        rows: [
                            {
                                index_name: "PK",
                                column_name: "Id",
                                is_primary_key: true,
                                is_unique: true,
                                is_nullable: false,
                            },
                        ],
                    };
                case "sqlEdit.properties":
                    return {
                        columns: [],
                        rows: [{ object_type: "user_table", is_memory_optimized: false }],
                    };
                case "sqlEdit.page":
                    return {
                        columns: [],
                        rows: [{ Id: "1" }, { Id: "2" }, { Id: "3" }],
                    };
                default:
                    return { columns: [], rows: [] };
            }
        },
    };

    const session = await EditSession.open(runner, "dbo", "T");
    const firstPage = await session.readPage({ pageSize: 2 });
    assert.deepEqual(firstPage.nextCursor, { Id: "2" });
    const exactPage = await session.readPage({ pageSize: 3 });
    assert.equal(exactPage.nextCursor, undefined);
});
