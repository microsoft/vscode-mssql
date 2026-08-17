/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("tablesample-cookies-and-bulk-order.sql");

suite("T-SQL TABLESAMPLE placement, execution cookies, and bulk ordering", () => {
    // TABLESAMPLE may follow the correlation name as well as precede it.
    test("parses TABLESAMPLE after a correlation name", () => {
        assertValid("SELECT * FROM t1 AS table1 TABLESAMPLE (12 + 3 ROWS);");
        assertValid("SELECT * FROM t1 a TABLESAMPLE SYSTEM (10 PERCENT);");
        assertValid("SELECT * FROM t1 AS a TABLESAMPLE (5 PERCENT) REPEATABLE (7);");
    });

    // The pre-alias placement and the plain forms must not regress.
    test("keeps existing TABLESAMPLE placements intact", () => {
        assertValid("SELECT * FROM t1 TABLESAMPLE (10 PERCENT);");
        assertValid("SELECT * FROM t1 TABLESAMPLE SYSTEM (100 ROWS);");
        assertValid("SELECT * FROM t1 AS a;");
        assertValid("SELECT * FROM t1 AS a WITH (NOLOCK);");
    });

    // NO REVERT and the cookie capture are independent.
    test("parses EXECUTE AS cookie clauses", () => {
        assertValid("EXECUTE AS USER = 'user2' WITH COOKIE INTO @v1;");
        assertValid("EXECUTE AS LOGIN = 'l' WITH COOKIE INTO @cookie;");
        assertValid("EXECUTE AS USER = 'u' WITH NO REVERT;");
        assertValid("EXECUTE AS USER = 'u';");
    });

    // ORDER is reserved, so the bulk sort-order option needs its own branch.
    test("parses BULK INSERT ORDER options", () => {
        assertValid("BULK INSERT t1 FROM 'f1' WITH (ORDER (c1 ASC), TABLOCK);");
        assertValid("BULK INSERT t1 FROM 'f1' WITH (ORDER (c1 ASC, c2 DESC));");
    });

    // The ordinary named bulk options keep working.
    test("keeps ordinary BULK INSERT options intact", () => {
        assertValid(
            "BULK INSERT t1 FROM 'f1' WITH (BATCHSIZE = 10, CHECK_CONSTRAINTS, CODEPAGE = 866, DATAFILETYPE = 'char');",
        );
        assertValid("BULK INSERT t1 FROM 'f1';");
    });

    // Newer providers use named arguments instead of the positional form.
    test("parses OPENROWSET named provider arguments", () => {
        assertValid(
            "SELECT * FROM OPENROWSET(PROVIDER = 'CosmosDB', CONNECTION = 'Account=a;Database=db1', OBJECT = 'a') AS r;",
        );
    });

    // The positional provider form and the BULK form keep working.
    test("keeps positional OPENROWSET forms intact", () => {
        assertValid("SELECT * FROM OPENROWSET('prov', 'src', 'obj') AS r;");
        assertValid("SELECT * FROM OPENROWSET(BULK 'data/items.csv', FORMAT = 'CSV') AS rows;");
    });

    // A damaged TABLESAMPLE must not leak past its GO batch.
    test("keeps a damaged TABLESAMPLE inside its GO batch", () => {
        const snapshot = parse("SELECT * FROM t1 AS a TABLESAMPLE (\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
