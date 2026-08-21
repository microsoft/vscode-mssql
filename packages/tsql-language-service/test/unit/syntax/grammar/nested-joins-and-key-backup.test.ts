/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("nested-joins-and-key-backup.sql");

suite("T-SQL nested joins, certificate backup, and service master key", () => {
    // Joins nest without parentheses: the inner join takes the first ON and the trailing ON closes
    // the outer join.
    test("parses joins nested without parentheses", () => {
        assertValid(
            "SELECT * FROM t1 INNER REMOTE JOIN t10 LEFT JOIN t11 ON t10.c1 > t11.c1 ON t1.c1 = t10.c1;",
        );
        assertValid("SELECT * FROM t1 JOIN t2 JOIN t3 ON t2.a = t3.a ON t1.a = t2.a;");
        assertValid(
            "SELECT * FROM a LEFT JOIN b INNER JOIN c ON b.i = c.i RIGHT JOIN d ON c.i = d.i ON a.i = b.i;",
        );
    });

    // The ordinary flat join chain and the explicitly parenthesized form must not regress.
    test("keeps flat and parenthesized join chains intact", () => {
        assertValid("SELECT * FROM t1 JOIN t2 ON t1.a = t2.a JOIN t3 ON t2.b = t3.b;");
        assertValid("SELECT * FROM t1 JOIN (t2 JOIN t3 ON t2.a = t3.a) ON t1.a = t2.a;");
        assertValid("SELECT * FROM t1 INNER LOOP JOIN t2 ON t1.a = t2.a;");
        assertValid("SELECT * FROM t1 LEFT OUTER JOIN t2 ON t1.a = t2.a;");
        assertValid("SELECT * FROM t1 CROSS JOIN t2;");
        assertValid("SELECT * FROM t1 CROSS APPLY dbo.f(t1.a) AS x;");
    });

    // A certificate backup writes the public certificate and optionally its private key.
    test("parses BACKUP CERTIFICATE", () => {
        assertValid("BACKUP CERTIFICATE c1 TO FILE = 'f1';");
        assertValid(
            "BACKUP CERTIFICATE c1 TO FILE = 'f1' WITH PRIVATE KEY (FILE = 'f2', ENCRYPTION BY PASSWORD = 'p1');",
        );
    });

    // The service master key is regenerated or rebound rather than re-encrypted.
    test("parses ALTER SERVICE MASTER KEY", () => {
        assertValid("ALTER SERVICE MASTER KEY REGENERATE;");
        assertValid("ALTER SERVICE MASTER KEY FORCE REGENERATE;");
        assertValid(
            "ALTER SERVICE MASTER KEY WITH NEW_ACCOUNT = 'AdvWorks\\Sandeep', NEW_PASSWORD = 'p';",
        );
    });

    // The database master key statements keep their own distinct shapes.
    test("keeps database master key statements intact", () => {
        assertValid("CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'p';");
        assertValid("ALTER MASTER KEY REGENERATE WITH ENCRYPTION BY PASSWORD = 'p';");
        assertValid("DROP MASTER KEY;");
        assertValid("BACKUP MASTER KEY TO FILE = 'f' ENCRYPTION BY PASSWORD = 'p';");
    });

    // A damaged join tail must not leak past its GO batch.
    test("keeps a damaged nested join inside its GO batch", () => {
        const snapshot = parse("SELECT * FROM t1 JOIN t2 JOIN t3 ON\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
