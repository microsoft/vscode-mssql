/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The injection boundary.
 *
 * The data plane has no parameter collection, so every value reaches the server inside the
 * statement text. These tests are the guarantee that nothing typed into a grid can become SQL.
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";

import { SqlEditError, quoteName, stringLiteral, binaryLiteral } from "../../src/edit/core/sql";
import { encodeValue } from "../../src/edit/types/valueCodec";
import { column, table } from "./fixtures";
import { compileFilters } from "../../src/edit/query/filter";
import { compileUpdate } from "../../src/edit/dml/compile";
import { chooseKeyStrategy } from "../../src/edit/metadata/keyStrategy";

void test("an identifier cannot close its own bracket", () => {
    assert.equal(quoteName("Order]s"), "[Order]]s]");
    assert.equal(quoteName("a]; DROP TABLE x --"), "[a]]; DROP TABLE x --]");
    // Round-tripping the escape is what proves it: one closing bracket became two.
    assert.ok(!/(^|[^\]])\](?!\])/.test(quoteName("a]b").slice(1, -1)));
});

void test("an empty or null-bearing identifier is refused, not silently accepted", () => {
    assert.throws(() => quoteName(""), SqlEditError);
    assert.throws(() => quoteName("   "), SqlEditError);
    assert.throws(() => quoteName("a\0b"), SqlEditError);
});

void test("a text literal cannot end early", () => {
    assert.equal(stringLiteral("O'Brien"), "N'O''Brien'");
    assert.equal(stringLiteral("'; DROP TABLE x --"), "N'''; DROP TABLE x --'");
});

void test("text literals are always Unicode, so characters are not lost to a collation", () => {
    assert.ok(stringLiteral("日本語").startsWith("N'"));
});

void test("a null character in text is refused rather than truncating the value", () => {
    assert.throws(() => stringLiteral("a\0b"), SqlEditError);
});

void test("binary is hex encoded", () => {
    assert.equal(binaryLiteral(new Uint8Array([0, 255, 16])), "0x00ff10");
    assert.equal(binaryLiteral(new Uint8Array()), "0x");
});

void test("a value is encoded by its column type, not by how it looks", () => {
    const intColumn = column("Total", "int");
    // The classic injection payload is not a number, so it never reaches the statement.
    assert.throws(() => encodeValue("1; DROP TABLE x", intColumn, "Total"), SqlEditError);
    assert.throws(() => encodeValue("1 OR 1=1", intColumn, "Total"), SqlEditError);
    assert.equal(encodeValue("42", intColumn, "Total"), "42");
});

void test("an injection attempt through a filter value stays inside a literal", () => {
    const meta = table();
    const sql = compileFilters(
        [{ column: "Name", operator: "equals", value: "x' OR '1'='1" }],
        meta.columns,
    );
    assert.equal(sql, "[Name] = N'x'' OR ''1''=''1'");
});

void test("an injection attempt through an edited cell stays inside a literal", () => {
    const meta = table();
    const statement = compileUpdate(meta, chooseKeyStrategy(meta), {
        rowId: 1,
        kind: "update",
        values: { Name: "'); DROP TABLE Orders; --" },
        original: { Id: "7", Name: "old" },
    });
    assert.ok(statement.sql.includes("N'''); DROP TABLE Orders; --'"));
    assert.ok(!statement.sql.includes("DROP TABLE Orders;\n"));
});

void test("a filter naming a column that does not exist is refused", () => {
    const meta = table();
    assert.throws(
        () => compileFilters([{ column: "NoSuch", operator: "equals", value: "1" }], meta.columns),
        SqlEditError,
    );
});

void test("LIKE metacharacters are escaped so a search for a percent sign works", () => {
    const meta = table();
    const sql = compileFilters(
        [{ column: "Name", operator: "contains", value: "50%_off" }],
        meta.columns,
    );
    assert.ok(sql!.includes("N'%50\\%\\_off%'"));
    assert.ok(sql!.includes("ESCAPE '\\'"));
});
