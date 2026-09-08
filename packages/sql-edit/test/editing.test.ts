/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The behaviours the previous engine got wrong: atomicity, concurrency, row identity, and
 * paging that does not degrade with table size.
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";

import { SqlEditError } from "../src/core/sql";
import { EditSession } from "../src/session/editSession";
import type { QueryResult, SqlRunner } from "../src/core/types";
import { chooseKeyStrategy } from "../src/metadata/keyStrategy";
import { column, index, table } from "./fixtures";
import { compileBatch, parseFailure, scriptBatch } from "../src/dml/commit";
import { compileDelete, compileInsert, compileUpdate, orderEdits } from "../src/dml/compile";
import { compilePageQuery, compileSeek, resolvePageOrder } from "../src/query/select";

// ---------------------------------------------------------------------------
// Row identity
// ---------------------------------------------------------------------------

void test("a primary key is preferred and explained", () => {
    const key = chooseKeyStrategy(table());
    assert.equal(key.kind, "primaryKey");
    assert.deepEqual(key.columns, ["Id"]);
    assert.equal(key.isAmbiguous, false);
    assert.match(key.explanation, /primary key/i);
});

void test("a non-null unique index is used when there is no primary key", () => {
    const meta = table({
        indexes: [index("UQ_Code", ["Code"], { isUnique: true, isNullable: false })],
        columns: [
            column("Code", "nvarchar", { maxLength: 20, isNullable: false }),
            column("Name", "nvarchar"),
        ],
    });
    const key = chooseKeyStrategy(meta);
    assert.equal(key.kind, "uniqueIndex");
    assert.deepEqual(key.columns, ["Code"]);
});

void test("a nullable unique index is not trusted to address a row", () => {
    // SQL Server permits one null per column in a unique index, so those rows are not addressable.
    const meta = table({
        indexes: [index("UQ_Code", ["Code"], { isUnique: true, isNullable: true })],
        columns: [column("Code", "nvarchar", { maxLength: 20 }), column("Name", "nvarchar")],
    });
    assert.equal(chooseKeyStrategy(meta).kind, "allColumns");
});

void test("a keyless table falls back to all columns and says so before anyone types", () => {
    const meta = table({
        indexes: [],
        columns: [column("Name", "nvarchar", { maxLength: 50 }), column("Total", "int")],
    });
    const key = chooseKeyStrategy(meta);
    assert.equal(key.kind, "allColumns");
    assert.equal(key.canEdit, true);
    assert.equal(key.isAmbiguous, true);
    assert.match(key.explanation, /no primary key/i);
    assert.match(key.explanation, /refused/i);
});

void test("a view without a unique index is read-only, with the reason", () => {
    const meta = table({ objectType: "view", indexes: [] });
    const key = chooseKeyStrategy(meta);
    assert.equal(key.canEdit, false);
    assert.match(key.explanation, /unique index/i);
});

// ---------------------------------------------------------------------------
// Single-row guarantee and concurrency
// ---------------------------------------------------------------------------

void test("every statement refuses to touch more than one row", () => {
    const meta = table();
    const key = chooseKeyStrategy(meta);
    const original = { Id: "7", Name: "old" };

    for (const statement of [
        compileUpdate(meta, key, { rowId: 1, kind: "update", values: { Name: "new" }, original }),
        compileDelete(meta, key, { rowId: 2, kind: "delete", original }),
        compileInsert(meta, { rowId: 3, kind: "insert", values: { Name: "new" } }),
    ]) {
        assert.ok(statement.guarded, `${statement.kind} must be guarded`);
        assert.match(statement.sql, /IF @@ROWCOUNT <> 1/);
        assert.match(statement.sql, /THROW 51000/);
    }
});

void test("an update also matches on the old values of the columns it writes", () => {
    // This is what makes a concurrent change visible instead of silently overwritten.
    const meta = table();
    const statement = compileUpdate(meta, chooseKeyStrategy(meta), {
        rowId: 1,
        kind: "update",
        values: { Name: "new" },
        original: { Id: "7", Name: "old" },
    });
    assert.match(statement.sql, /WHERE \[Id\] = 7 AND \[Name\] = N'old'/);
});

void test("a rowversion is used as the concurrency token when the table has one", () => {
    // One narrow column that changes on every write beats comparing the edited columns.
    const meta = table({
        rowVersionColumn: "Version",
        columns: [
            column("Id", "int", { isNullable: false }),
            column("Name", "nvarchar", { maxLength: 50 }),
            column("Version", "rowversion", { isNullable: false }),
        ],
    });
    const statement = compileUpdate(meta, chooseKeyStrategy(meta), {
        rowId: 1,
        kind: "update",
        values: { Name: "new" },
        original: { Id: "7", Name: "old", Version: "0x00000000000007D1" },
    });
    assert.match(statement.sql, /\[Version\] = 0x00000000000007d1/i);
    assert.ok(
        !statement.sql.includes("[Name] = N'old'"),
        "the rowversion replaces value comparison",
    );
});

void test("a null original value is matched with IS NULL, not with equality", () => {
    const meta = table();
    const statement = compileUpdate(meta, chooseKeyStrategy(meta), {
        rowId: 1,
        kind: "update",
        values: { Name: "new" },
        original: { Id: "7", Name: null },
    });
    assert.match(statement.sql, /\[Name\] IS NULL/);
});

// ---------------------------------------------------------------------------
// Read-only columns
// ---------------------------------------------------------------------------

void test("computed, identity and rowversion columns cannot be written", () => {
    const meta = table({
        columns: [
            column("Id", "int", { isIdentity: true, isNullable: false }),
            column("Total", "int", { isComputed: true }),
            column("Version", "rowversion"),
            column("Name", "nvarchar", { maxLength: 50 }),
        ],
    });
    const key = chooseKeyStrategy(table());
    for (const bad of ["Id", "Total", "Version"]) {
        assert.throws(
            () =>
                compileUpdate(meta, key, {
                    rowId: 1,
                    kind: "update",
                    values: { [bad]: "1" },
                    original: { Id: "7" },
                }),
            SqlEditError,
            `${bad} must be rejected`,
        );
    }
});

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------

void test("a save is one transaction, so a failure leaves nothing applied", () => {
    const meta = table();
    const key = chooseKeyStrategy(meta);
    const batch = compileBatch(meta, key, [
        { rowId: 1, kind: "update", values: { Name: "a" }, original: { Id: "1", Name: "x" } },
        { rowId: 2, kind: "delete", original: { Id: "2", Name: "y" } },
        { rowId: 3, kind: "insert", values: { Name: "c" } },
    ]);
    assert.match(batch.sql, /SET XACT_ABORT ON/);
    assert.match(batch.sql, /BEGIN TRANSACTION/);
    assert.match(batch.sql, /COMMIT TRANSACTION/);
    assert.equal(batch.statements.length, 3);
});

void test("deletes run before updates before inserts, so values can be reused", () => {
    const ordered = orderEdits([
        { rowId: 3, kind: "insert", values: { Name: "c" } },
        { rowId: 1, kind: "update", values: { Name: "a" }, original: { Id: "1" } },
        { rowId: 2, kind: "delete", original: { Id: "2" } },
    ]);
    assert.deepEqual(
        ordered.map((e) => e.kind),
        ["delete", "update", "insert"],
    );
});

void test("the previewed script is the statement that runs", () => {
    const meta = table();
    const key = chooseKeyStrategy(meta);
    const edits = [
        {
            rowId: 1,
            kind: "update" as const,
            values: { Name: "a" },
            original: { Id: "1", Name: "x" },
        },
    ];
    assert.equal(scriptBatch(meta, key, edits), compileBatch(meta, key, edits).sql);
});

void test("saving nothing is refused rather than sending an empty transaction", () => {
    const meta = table();
    assert.throws(() => compileBatch(meta, chooseKeyStrategy(meta), []), SqlEditError);
});

void test("a guard failure names the row and explains it in the user's terms", () => {
    const meta = table();
    const batch = compileBatch(meta, chooseKeyStrategy(meta), [
        { rowId: 42, kind: "update", values: { Name: "a" }, original: { Id: "1", Name: "x" } },
    ]);
    const failure = parseFailure("sql-edit:42:update:update", batch.statements);
    assert.equal(failure?.rowId, 42);
    assert.equal(failure?.reason, "changedOrDeleted");
    assert.match(failure!.message, /changed on the server/i);
});

void test("an unrelated server error is not reshaped into a row failure", () => {
    const meta = table();
    const batch = compileBatch(meta, chooseKeyStrategy(meta), [
        { rowId: 1, kind: "delete", original: { Id: "1" } },
    ]);
    assert.equal(parseFailure("Violation of PRIMARY KEY constraint", batch.statements), undefined);
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

void test("the first page seeks nothing and orders by the key", () => {
    const meta = table();
    const page = compilePageQuery(meta, chooseKeyStrategy(meta), { pageSize: 100 });
    assert.match(page.sql, /SELECT TOP \(100\)/);
    assert.match(page.sql, /ORDER BY \[Id\] ASC/);
    assert.ok(!page.sql.includes("WHERE"), "a first page has nothing to seek past");
});

void test("page queries can include one lookahead row without changing the requested page size", () => {
    const meta = table();
    const page = compilePageQuery(
        meta,
        chooseKeyStrategy(meta),
        { pageSize: 100 },
        {
            includeLookahead: true,
        },
    );
    assert.equal(page.pageSize, 100);
    assert.match(page.sql, /SELECT TOP \(101\)/);
});

void test("readPage does not advertise a next page when the result is exactly full", async () => {
    const rows = [
        { Id: "1", Name: "one" },
        { Id: "2", Name: "two" },
        { Id: "3", Name: "three" },
    ];
    const result = (pageRows: Record<string, string>[]): QueryResult => ({
        rows: pageRows,
        columns: [],
    });
    const runner: SqlRunner = {
        query: async (_sql, options) => {
            switch (options?.tag) {
                case "sqlEdit.columns":
                    return result([
                        {
                            column_name: "Id",
                            ordinal: "1",
                            type_name: "int",
                            max_length: "4",
                            precision: "10",
                            scale: "0",
                            is_nullable: "0",
                            is_identity: "1",
                            is_computed: "0",
                            has_default: "0",
                        },
                        {
                            column_name: "Name",
                            ordinal: "2",
                            type_name: "nvarchar",
                            max_length: "100",
                            precision: "0",
                            scale: "0",
                            is_nullable: "1",
                            is_identity: "0",
                            is_computed: "0",
                            has_default: "0",
                        },
                    ]);
                case "sqlEdit.indexes":
                    return result([
                        {
                            index_name: "PK_Orders",
                            is_primary_key: "1",
                            is_unique: "1",
                            column_name: "Id",
                            key_ordinal: "1",
                            is_nullable: "0",
                        },
                    ]);
                case "sqlEdit.properties":
                    return result([{ object_type: "USER_TABLE", is_memory_optimized: "0" }]);
                case "sqlEdit.page":
                    return result(rows);
                default:
                    throw new Error(`Unexpected query tag: ${options?.tag}`);
            }
        },
    };
    const session = await EditSession.open(runner, "dbo", "Orders");

    const firstPage = await session.readPage({ pageSize: 2 });
    assert.equal(firstPage.rows.length, 2);
    assert.deepEqual(firstPage.nextCursor, { Id: "2" });

    const exactPage = await session.readPage({ pageSize: 3 });
    assert.equal(exactPage.rows.length, 3);
    assert.equal(exactPage.nextCursor, undefined);
});

void test("paging is a keyset seek, never an offset", () => {
    const meta = table();
    const page = compilePageQuery(meta, chooseKeyStrategy(meta), {
        pageSize: 50,
        cursor: { Id: "500000" },
    });
    assert.match(page.sql, /\[Id\] > 500000/);
    assert.ok(!/OFFSET/i.test(page.sql), "OFFSET makes the server walk every skipped row");
});

void test("a user sort keeps the key as a tiebreak, or paging would skip rows", () => {
    const key = chooseKeyStrategy(table());
    const order = resolvePageOrder([{ column: "Name" }], key);
    assert.deepEqual(order, [{ column: "Name" }, { column: "Id", descending: false }]);
});

void test("a compound seek advances one column at a time", () => {
    const meta = table();
    const seek = compileSeek(
        { Name: "b", Id: "7" },
        [{ column: "Name" }, { column: "Id" }],
        meta.columns,
    );
    // Either the first column advances, or it ties and the second one does.
    assert.match(seek, /\(\[Name\] > N'b'\) OR \(\[Name\] = N'b' AND \[Id\] > 7\)/);
});

void test("a descending sort seeks downwards", () => {
    const meta = table();
    const seek = compileSeek({ Id: "7" }, [{ column: "Id", descending: true }], meta.columns);
    assert.match(seek, /\[Id\] < 7/);
});

void test("a null in the cursor is handled, since nulls sort first", () => {
    const meta = table();
    const seek = compileSeek(
        { Name: null, Id: "7" },
        [{ column: "Name" }, { column: "Id" }],
        meta.columns,
    );
    assert.match(seek, /\[Name\] IS NOT NULL/);
    assert.match(seek, /\[Name\] IS NULL AND \[Id\] > 7/);
});

void test("filters and the seek combine rather than replacing each other", () => {
    const meta = table();
    const page = compilePageQuery(meta, chooseKeyStrategy(meta), {
        pageSize: 25,
        filters: [{ column: "Name", operator: "startsWith", value: "a" }],
        cursor: { Id: "10" },
    });
    assert.match(page.sql, /\[Name\] LIKE N'a%'/);
    assert.match(page.sql, /\[Id\] > 10/);
    assert.match(page.sql, /AND/);
});

void test("a page size must be a positive whole number", () => {
    const meta = table();
    const key = chooseKeyStrategy(meta);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
        assert.throws(() => compilePageQuery(meta, key, { pageSize: bad }), SqlEditError);
    }
});
