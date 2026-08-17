/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

// Every positive form here was confirmed against ScriptDOM before the grammar was changed, and
// every rejected neighbour below was confirmed to be rejected by ScriptDOM too.
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("partition-scope-nulls-and-kill.sql");

suite("T-SQL partition-scoped options, null treatment, and KILL variants", () => {
    // A compression setting may narrow itself to a partition list, alone or in ranges.
    test("parses ON PARTITIONS on compression settings", () => {
        assertValid(
            "ALTER TABLE t1 REBUILD PARTITION = ALL WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (1, 3 TO 5));",
        );
        assertValid(
            "ALTER INDEX i1 ON t1 REBUILD PARTITION = 2 WITH (DATA_COMPRESSION = ROW ON PARTITIONS (2));",
        );
        assertValid(
            "CREATE INDEX i1 ON t1 (c1) WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (1 TO 4));",
        );
        assertValid("UPDATE STATISTICS t1 s1 WITH RESAMPLE ON PARTITIONS (1, 2);");
    });

    // A window function may state how it treats nulls between its argument list and OVER.
    test("parses RESPECT and IGNORE NULLS", () => {
        assertValid("SELECT LAG(c1) IGNORE NULLS OVER (ORDER BY c2) FROM t1;");
        assertValid(
            "SELECT FIRST_VALUE(c1) RESPECT NULLS OVER (PARTITION BY c2 ORDER BY c3) FROM t1;",
        );
        assertValid("SELECT LAG(c1) OVER (ORDER BY c2) FROM t1;");
    });

    // INLINE is the one function option written as an assignment.
    test("parses the INLINE function option in every function shape", () => {
        assertValid("CREATE FUNCTION dbo.f1() RETURNS int WITH INLINE = ON AS BEGIN RETURN 1 END;");
        assertValid(
            "CREATE FUNCTION dbo.f1() RETURNS TABLE WITH INLINE = ON AS RETURN (SELECT 1 AS c);",
        );
        assertValid(
            "CREATE FUNCTION dbo.f1() RETURNS int WITH INLINE = OFF, SCHEMABINDING AS BEGIN RETURN 1 END;",
        );
    });

    // Always Encrypted key permissions name several otherwise-reserved words in sequence.
    test("parses Always Encrypted key permissions", () => {
        assertValid("GRANT ALTER ANY COLUMN MASTER KEY TO u1;");
        assertValid("GRANT VIEW ANY COLUMN ENCRYPTION KEY DEFINITION TO u1;");
        assertValid("DENY ALTER ANY COLUMN ENCRYPTION KEY TO u1;");
    });

    // A marked transaction names an optional description; DISTRIBUTED keeps its own place.
    test("parses BEGIN TRANSACTION WITH MARK", () => {
        assertValid("BEGIN TRANSACTION t1 WITH MARK;");
        assertValid("BEGIN TRANSACTION t1 WITH MARK 'checkpoint';");
        assertValid("BEGIN DISTRIBUTED TRAN t1;");
        assertValid("BEGIN TRANSACTION;");
    });

    // Closing every symmetric key at once is its own form alongside closing one by name.
    test("parses CLOSE ALL SYMMETRIC KEYS", () => {
        assertValid("CLOSE ALL SYMMETRIC KEYS;");
        assertValid("CLOSE SYMMETRIC KEY k1;");
        assertValid("OPEN SYMMETRIC KEY k1 DECRYPTION BY CERTIFICATE c1;");
    });

    // KILL either names a session directly or leads with a fixed keyword sequence.
    test("parses every KILL variant", () => {
        assertValid("KILL 53;");
        assertValid("KILL '2A3B4C55-1234-1234-1234-123456789012';");
        assertValid("KILL 53 WITH STATUSONLY;");
        assertValid("KILL STATS JOB 1234;");
        assertValid("KILL QUERY NOTIFICATION SUBSCRIPTION ALL;");
        assertValid("KILL QUERY NOTIFICATION SUBSCRIPTION 12;");
    });

    // Neighbours that ScriptDOM rejects must not parse as clean T-SQL here either. The grammar
    // keeps the vocabulary permissive so a misspelling retains an exact range; the allowlist that
    // makes these an error lives in the semantic pass and is covered by its own suite.
    test("rejects neighbours that the product rejects", () => {
        for (const sql of [
            "CLOSE ALL ASYMMETRIC KEYS;",
            "BEGIN TRANSACTION t1 WITH FOO;",
            "SELECT LAG(c1) IGNORE VALUES OVER (ORDER BY c2) FROM t1;",
            "SELECT LAG(c1) FOO NULLS OVER (ORDER BY c2) FROM t1;",
            "CREATE FUNCTION dbo.f1() RETURNS int WITH INLINE = MAYBE AS BEGIN RETURN 1 END;",
            "KILL alpha 12;",
        ]) {
            assert.ok(parse(sql).statistics.rawErrorNodeCount > 0, sql);
        }
    });

    // A damaged partition list must not leak past its GO batch.
    test("keeps a damaged partition list inside its GO batch", () => {
        const snapshot = parse(
            "ALTER INDEX i1 ON t1 REBUILD WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (\nGO\nSELECT 1;",
        );
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
