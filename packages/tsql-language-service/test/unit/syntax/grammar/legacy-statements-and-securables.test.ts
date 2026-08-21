/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { ImmutableTextSnapshot, LezerSyntaxService } from "../../../../src/index.ts";

// Every positive form here was confirmed against ScriptDOM before the grammar was changed.
import { assertIncrementalEquivalent, createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("legacy-statements-and-securables.sql");

suite("T-SQL legacy statements, securable classes, and TOP shapes", () => {
    // CREATE RULE binds a legacy standalone predicate to a name.
    test("parses CREATE RULE", () => {
        assertValid("create rule dbo.r1 as @a1 > 10");
        assertValid("create rule r1 as @a1 > 10 and @a2 between 20 and 39");
        assertValid("drop rule r1");
    });

    // SETUSER impersonates a user; the bare form reverts.
    test("parses SETUSER in every shape", () => {
        assertValid("setuser");
        assertValid("setuser @user1");
        assertValid("setuser 'user' with noreset");
        assertValid("setuser N'user'");
    });

    // LINENO sets the reported line number.
    test("parses LINENO", () => {
        assertValid("lineno 42");
    });

    // TRUNCATE TABLE accepts SQL Server's omitted server/database name components.
    test("parses TRUNCATE TABLE with an omitted name component", () => {
        assertValid("truncate table ..[t1]");
        assertValid("truncate table dbo.[t1]");
        assertValid("truncate table [t1]");
    });

    // EXEC is a permission word in its own right, beside EXECUTE.
    test("parses EXEC as a granted permission", () => {
        assertValid(
            "grant ALL, SELECT (c1, c2), INSERT, DELETE, UPDATE, EXEC, EXECUTE, REFERENCES(c1, c2) on t2 to guest",
        );
        assertValid("grant SELECT on ..t1 to public");
    });

    // EXTERNAL MODEL is a securable class, so it may precede :: in a permission target.
    test("parses the EXTERNAL MODEL securable class", () => {
        assertValid("GRANT ALTER ANY EXTERNAL MODEL TO datascientist;");
        assertValid("GRANT EXECUTE ON EXTERNAL MODEL::MyPredictionModel TO analyst;");
        assertValid("GRANT CONTROL ON EXTERNAL MODEL::SalesModel TO mladmin AS dbo;");
        assertValid("DENY ALTER ANY EXTERNAL MODEL TO reader;");
        assertValid("GRANT CONTROL ON OBJECT::t1 TO u1;");
    });

    // WAITFOR accepts delay/time values and parenthesized Service Broker statements. The outer
    // closing parenthesis and optional TIMEOUT remain outside the mounted inner statement.
    test("parses complete WAITFOR forms", () => {
        assertValid("WAITFOR DELAY '00:00:02'");
        assertValid("WAITFOR TIME '22:20'");
        assertValid("WAITFOR (RECEIVE * FROM ExpenseQueue), TIMEOUT 60000;");
        assertValid("WAITFOR (GET CONVERSATION GROUP @conversation_group_id FROM ExpenseQueue);");
        assertValid("GET CONVERSATION GROUP @group_id FROM dbo.ExpenseQueue;");

        for (const sql of [
            "WAITFOR ();",
            "WAITFOR (RECEIVE * FROM q, TIMEOUT 1;",
            "WAITFOR (RECEIVE * FROM q) BANANA 1;",
        ]) {
            const damaged = parse(`${sql}\nGO\nSELECT 1;`);
            assert.ok(damaged.diagnostics.length > 0);
            assert.match(damaged.tree.toString(), /SelectStatement\(/);
        }
    });

    // Editing the mounted statement or timeout produces the same result as a fresh parse.
    test("keeps receive WAITFOR incrementally equivalent", () => {
        const service = new LezerSyntaxService();
        const sql = "WAITFOR (RECEIVE * FROM q), TIMEOUT 60000;\nGO\nSELECT 1;";
        const previousDocument = new ImmutableTextSnapshot("file:///waitfor.sql", 1, sql);
        const previousSnapshot = service.parse(previousDocument);
        const start = sql.indexOf("60000");
        assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start + 5, text: "50000" }],
            assertReuse: false,
        });
    });

    // TOP PERCENT accepts a fractional row count, and the quantifier precedes TOP.
    test("parses TOP with a decimal row count and a leading quantifier", () => {
        assertValid("select top 20.12 percent with ties c1 from t1;");
        assertValid("select all top 80 percent with ties c1 from t1;");
        assertValid("select distinct top 80 percent c1 from t1;");
        assertValid("select top 10000 c1 from t1;");
        assertValid("select top (@n) c1 from t1;");
    });

    // The product rejects a quantifier after TOP; so must this grammar.
    test("rejects a quantifier written after TOP", () => {
        for (const sql of ["select top 80 all c1 from t1;", "select top 80 distinct c1 from t1;"]) {
            assert.ok(parse(sql).statistics.rawErrorNodeCount > 0, sql);
        }
    });

    // A damaged CREATE RULE must not leak past its GO batch.
    test("keeps a damaged rule body inside its GO batch", () => {
        const snapshot = parse("create rule r1 as\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
