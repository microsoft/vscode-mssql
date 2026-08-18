/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

// Every positive form here was confirmed against ScriptDOM before the grammar was changed, and
// every rejected neighbour below was confirmed to be rejected by ScriptDOM too.
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("udt-member-targets.sql");

suite("T-SQL UDT member targets and parenthesized member access", () => {
    // A SET target reaches one member level through either operator.
    test("parses SET targets naming a UDT member", () => {
        assertValid("set @a.b = 12 / 34");
        assertValid("set @a::b = 12 / 34");
        assertValid("set @a.b()");
        assertValid("set @a::b()");
        assertValid("set @a.b(1, default, a.b::func())");
    });

    // Ordinary variable assignment must not regress.
    test("keeps ordinary SET assignments intact", () => {
        assertValid("set @a = 12");
        assertValid("set @a += 1");
        assertValid("set nocount on");
    });

    // The product allows exactly one member level in a SET target, and `::` only there.
    test("rejects SET target shapes the product rejects", () => {
        for (const sql of [
            "set @a.b",
            "set @a::b",
            "set @a.b.c = 1",
            "set @a.b().c = 1",
            "select @a::b from t1",
        ]) {
            assert.ok(parse(sql).statistics.rawErrorNodeCount > 0, sql);
        }
    });

    // An UPDATE SET item may call a method on a UDT column instead of assigning it.
    test("parses UPDATE SET method calls and long column targets", () => {
        assertValid("Update t1 set a.b.c.d.func()");
        assertValid("Update t1 set a.b.c.d.e = 100 - [udt]::t1.f()");
        assertValid("update t1 set c1 = 1");
        assertValid("update t1 set c1 += 1");
    });

    // A parenthesized value exposes CLR members.
    test("parses member access on a parenthesized expression", () => {
        assertValid("select (a.b()).A from t1");
        assertValid("select (1 + 2) from t1");
        assertValid("select (select top 1 c1 from t2) from t1");
    });

    // UPDATE TOP accepts a query as well as an expression.
    test("parses UPDATE TOP with a query and an expression", () => {
        assertValid("update top (2.5) percent t1 set c1 = 23 + 10");
        assertValid("update top (select * from t2) t1 set c1 = 23 + 10");
        assertValid("update top (5) t1 set c1 = 1");
    });

    // A damaged SET member target must not leak past its GO batch.
    test("keeps a damaged SET member target inside its GO batch", () => {
        const snapshot = parse("set @a.b =\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
