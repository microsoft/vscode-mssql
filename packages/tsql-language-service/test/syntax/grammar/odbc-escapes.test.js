/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("odbc-escapes.sql");

suite("T-SQL ODBC escape grammar", () => {
    // Verifies ODBC function escapes support nesting and EXTRACT's FROM argument syntax.
    test("parses ODBC function escapes", () => {
        const snapshot = parse(`
SELECT {fn convert(@value, sql_int)},
       {fn BuiltinFunc1(@value, {fn user()})},
       {fn extract(hour from getdate())};`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/OdbcEscapeExpression\(/g) ?? []).length, 4);
    });

    // Verifies ODBC date, time, and timestamp literal escapes remain structured expressions.
    test("parses ODBC temporal literal escapes", () => {
        const snapshot = parse(
            "SELECT {d '2026-01-01'}, {t '10:00:00'}, {ts N'2026-01-01 10:00:00'};",
        );

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/OdbcEscapeExpression\(/g) ?? []).length, 3);
    });

    // Verifies the braced ODBC ESCAPE clause attaches only to a LIKE predicate.
    test("parses an ODBC LIKE escape clause", () => {
        const snapshot = parse("SELECT 1 WHERE value LIKE '50%%' {ESCAPE '%'};");

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /OdbcEscapeClause\(/);
    });

    // Verifies an unclosed ODBC function escape still produces a syntax diagnostic.
    test("reports an incomplete ODBC escape", () => {
        assert.ok(parse("SELECT {fn user();").diagnostics.length > 0);
    });
});
