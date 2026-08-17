/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("output-namespaces-and-backup-lists.sql");

suite("T-SQL OUTPUT routing, XML namespaces, and backup file lists", () => {
    // A statement may route rows into a table and still return a projection to the client.
    test("parses OUTPUT INTO followed by a client OUTPUT list", () => {
        assertValid("DELETE t1 OUTPUT deleted.c1 INTO @t1 OUTPUT deleted.c1 AS [C1];");
        assertValid(
            "INSERT @v2 OUTPUT inserted.c1, inserted.c2 INTO @t1 OUTPUT inserted.c1 AS [C1], 12 * 12 AS [144] VALUES (10, 20);",
        );
    });

    // The single-OUTPUT forms must not regress.
    test("keeps single OUTPUT forms intact", () => {
        assertValid("DELETE t1 OUTPUT deleted.c1;");
        assertValid("DELETE t1 OUTPUT deleted.c1 INTO @t1;");
        assertValid("INSERT t1 OUTPUT inserted.c1 INTO dbo.a(c1) VALUES (1);");
        assertValid("UPDATE t1 SET c1 = 1 OUTPUT inserted.c1, deleted.c1;");
    });

    // A SELECT may declare XML namespaces in the same WITH header that declares CTEs.
    test("parses XMLNAMESPACES headers on SELECT", () => {
        assertValid("WITH XMLNAMESPACES(N'u' AS n1, 'u2' AS n2) SELECT c1 FROM t1;");
        assertValid("WITH XMLNAMESPACES(DEFAULT 'u') SELECT c1 FROM t1 FOR XML PATH;");
        assertValid("WITH XMLNAMESPACES('u' AS n1), c1(a) AS (SELECT 1) SELECT * FROM c1;");
    });

    // Ordinary CTE headers keep working on SELECT.
    test("keeps ordinary SELECT CTE headers intact", () => {
        assertValid("WITH c1(a) AS (SELECT 1) SELECT * FROM c1;");
        assertValid("WITH c1 AS (SELECT 1), c2 AS (SELECT 2) SELECT * FROM c1, c2;");
        assertValid("SELECT 1;");
    });

    // A backup file selection value may be one name or a parenthesized list.
    test("parses backup file selection lists", () => {
        assertValid("BACKUP DATABASE d1 FILE = 'f1', FILE = ('f2', @v) TO TAPE = 'x';");
        assertValid("BACKUP DATABASE d1 FILE = 'f1', FILE = @var3 TO TAPE = 'x';");
        assertValid("BACKUP DATABASE d1 FILEGROUP = ('fg1', 'fg2') TO DISK = 'b.bak';");
    });

    // A column list argument to a rowset function needs at least two names.
    test("parses column list arguments to semantic rowset functions", () => {
        assertValid("SELECT * FROM SEMANTICKEYPHRASETABLE(db1.s1.t1, (c1, c2, c3), -10) t;");
        assertValid("SELECT * FROM SEMANTICKEYPHRASETABLE(t1, (c1, c2)) t;");
    });

    // A certificate's dialog activity may be set with or without the WITH keyword.
    test("parses ALTER CERTIFICATE activity clauses", () => {
        assertValid("ALTER CERTIFICATE c1 WITH ACTIVE FOR BEGIN_DIALOG = ON;");
        assertValid("ALTER CERTIFICATE c1 REMOVE PRIVATE KEY;");
    });

    // A damaged OUTPUT tail must not leak past its GO batch.
    test("keeps a damaged OUTPUT clause inside its GO batch", () => {
        const snapshot = parse("DELETE t1 OUTPUT deleted.c1 INTO @t1 OUTPUT\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
