/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { ImmutableTextSnapshot, LezerSyntaxService } = require("../../../dist/index.js");
const {
    assertIncrementalEquivalent,
    createSyntaxHarness,
} = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("assignment-and-hints.sql");

suite("T-SQL compound assignment and query hints", () => {
    // A select list may assign into a variable with any compound operator, not only '='.
    test("parses select-list compound variable assignment", () => {
        const snapshot = assertValid(`
SELECT @a += 1;
SELECT @a -= 1;
SELECT @a /= 1;
SELECT @a %= 1;
SELECT @a &= 1;
SELECT @a |= 1;
SELECT @a ^= 1;
`);
        assert.equal(
            (snapshot.tree.toString().match(/SelectVariableAssignment\(/g) ?? []).length,
            7,
        );
    });

    // Plain '=' keeps its existing reading so this addition cannot change established trees.
    test("keeps plain select-list assignment and legacy *= intact", () => {
        assertValid("SELECT @a = 1;");
        assertValid("SELECT @a *= 1;");
        assertValid("SELECT @a = c1 FROM t;");
    });

    // SQL Server 2022 adds '||' concatenation and its '||=' compound assignment.
    test("parses the string concatenation operator and its assignment", () => {
        assertValid("SELECT 'ab' || N'ab' || 1;");
        assertValid("SELECT c1 || c1 FROM t1;");
        assertValid("SELECT 0x12 || 0xab;");
        assertValid("SET @a ||= 1;");
        assertValid("SET @a ||= 'foo' || 'bar';");
        assertValid("SELECT @a ||= 1;");
        assertValid("UPDATE t1 SET @a ||= 1;");
        assertValid("UPDATE t1 SET c1 ||= 1, c1 ||= null;");
        assertValid("UPDATE t1 SET @a = c1 ||= 1, @a = c1 ||= null;");
    });

    // '||' must stay a single token rather than two bitwise-or operators.
    test("keeps || distinct from a doubled bitwise or", () => {
        const snapshot = assertValid("SELECT 1 || 2;");
        assert.match(snapshot.tree.toString(), /DoublePipe/);
        assert.doesNotMatch(snapshot.tree.toString(), /Pipe,Pipe/);
    });

    // Strategy hints pair a word with a reserved clause keyword.
    test("parses reserved-word query hint phrases", () => {
        assertValid("SELECT * FROM t1 OPTION (ORDER GROUP);");
        assertValid("SELECT * FROM t1 OPTION (ORDER GROUP, HASH UNION, MERGE JOIN);");
        assertValid(
            "SELECT * FROM t1 OPTION (HASH GROUP, CONCAT UNION, LOOP JOIN, FAST 10, FORCE ORDER, MAXDOP 2);",
        );
        assertValid("SELECT * FROM t1 OPTION (KEEP UNION, ROBUST PLAN);");
        assertValid("SELECT * FROM t1 OPTION (MERGE UNION, HASH JOIN);");
        assertValid("DELETE t1 OPTION (ORDER GROUP);");
    });

    // USE HINT takes a string list and USE PLAN takes one plan literal.
    test("parses USE HINT and USE PLAN hints", () => {
        assertValid("SELECT * FROM t1 OPTION (USE HINT('DISABLE_OPTIMIZED_NESTED_LOOP'));");
        assertValid(
            "SELECT * FROM t1 OPTION (USE HINT('A', 'HINT #2'), RECOMPILE, USE HINT('B'));",
        );
        assertValid("SELECT * FROM t1 OPTION (USE PLAN N'stored_plan');");
        assertValid(
            "SELECT * FROM t1 OPTION (PARAMETERIZATION SIMPLE, RECOMPILE, USE PLAN N'zzz', MAXRECURSION 1);",
        );
    });

    // OPTIMIZE FOR pins parameters to values or declares them UNKNOWN.
    test("parses OPTIMIZE FOR parameter pinning", () => {
        assertValid("SELECT * FROM t1 OPTION (OPTIMIZE FOR (@v1 = 20, @v2 = NULL));");
        assertValid("SELECT * FROM t1 OPTION (OPTIMIZE FOR (@v4 unknown));");
        assertValid(
            "SELECT * FROM t1 OPTION (OPTIMIZE FOR(@v1 = 20, @v2 = NULL), OPTIMIZE FOR(@v3='zzz'), OPTIMIZE FOR(@v4 unknown));",
        );
    });

    // Previously working single-word and assignment hints must not regress.
    test("keeps existing query hint shapes intact", () => {
        for (const hint of [
            "RECOMPILE",
            "MAXDOP 2",
            "fast 5, maxdop 2",
            "LABEL = 'TabelT1'",
            "MAX_GRANT_PERCENT = 50.44, MIN_GRANT_PERCENT = 50.44",
            "KEEPFIXED PLAN",
            "EXPAND VIEWS",
            "NO_PERFORMANCE_SPOOL",
            "IGNORE_NONCLUSTERED_COLUMNSTORE_INDEX",
            "TABLE HINT (t2, readcommitted, index (i1))",
        ]) {
            assertValid(`SELECT * FROM t1 OPTION (${hint});`);
        }
    });

    // A damaged hint list must not leak past its GO batch.
    test("keeps a damaged query hint inside its GO batch", () => {
        const sql = "SELECT * FROM t1 OPTION (ORDER\nGO\nSELECT 1;";
        const snapshot = parse(sql);
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });

    // Incremental typing of a compound assignment must match a fresh parse.
    test("keeps incremental compound assignment equivalent to a fresh parse", () => {
        const service = new LezerSyntaxService();
        const beforeText = "SELECT @a = 1;\nGO\nSELECT 1;";
        const previousDocument = new ImmutableTextSnapshot("file:///assign.sql", 1, beforeText);
        const previousSnapshot = service.parse(previousDocument);
        const start = beforeText.indexOf("=");
        const { incremental, fresh } = assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start + 1, text: "+=" }],
            assertReuse: false,
        });
        assert.deepEqual(incremental.diagnostics, []);
        assert.deepEqual(fresh.diagnostics, []);
        assert.match(fresh.tree.toString(), /SelectVariableAssignment\(/);
    });
});
