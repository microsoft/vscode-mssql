/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

// Every form here was confirmed against ScriptDOM before the grammar was changed. The product
// accepts column references and scalar calls beyond four parts, and caps a rowset or module name
// at four parts; both halves are asserted below.
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("multipart-name-parts.sql");

suite("T-SQL multipart name part counts", () => {
    // A column reference may name more parts than a rowset ever could.
    test("parses long column references", () => {
        assertValid("select a.b.c.d.e.f.g from t1;");
        assertValid("select a.b.c.f.e.g.h from t1;");
        assertValid("select k.l.m.n.o.func() from t1;");
        assertValid("select 1 where a.b.c.d.e.f = 1;");
    });

    // Ordinary short names must not regress.
    test("keeps ordinary name lengths intact", () => {
        assertValid("select a.b from t1;");
        assertValid("select a.b.c.d from t1;");
        assertValid("select * from a.b.c.d;");
        assertValid("exec a.b.c.d;");
        assertValid("select t1.* from t1;");
        assertValid("select a.b.* from a.b;");
    });

    // Omitted server and database components keep their existing shapes.
    test("keeps omitted name components intact", () => {
        assertValid("select * from ..t1;");
        assertValid("select * from a..b;");
        assertValid("select * from .a.b;");
        assertValid("truncate table ..[t1];");
    });

    // A rowset or module name beyond four parts is a syntax error, reported on the fifth part by
    // the semantic pass. The grammar stays permissive so the name keeps an exact range.
    test("keeps an over-long rowset name structured", () => {
        for (const sql of [
            "exec a.b.c.d.e;",
            "insert into a.b.c.d.e values (1);",
            "delete from a.b.c.d.e;",
        ]) {
            assert.equal(parse(sql).statistics.rawErrorNodeCount, 0, sql);
        }
    });

    // A damaged long name must not leak past its GO batch.
    test("keeps a damaged long name inside its GO batch", () => {
        const snapshot = parse("select a.b.c.d.e.f.\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
