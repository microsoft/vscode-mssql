/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { LezerSyntaxService } = require("../../../dist/index.js");
const {
    assertIncrementalEquivalent,
    createSyntaxHarness,
} = require("../../support/syntaxHarness.js");
const { assertValid, document, parse } = createSyntaxHarness("grouped-query-statements.sql");

suite("T-SQL grouped query statements", () => {
    // A statement-leading grouped query owns both parentheses as grammar nodes, not hidden errors.
    test("builds an error-free structural tree for a grouped SELECT", () => {
        for (const sql of [
            "(SELECT 1);",
            "(SELECT c1 FROM t1);",
            "(SELECT 1) UNION SELECT 2;",
            "((SELECT 1));",
        ]) {
            const snapshot = assertValid(sql);
            assert.match(
                snapshot.tree.toString(),
                /GroupedQueryStatement\(GroupedQueryRoot\(GroupedSelectStatement\(GroupedParenthesizedQuery\(OpenParen/,
            );
            assert.doesNotMatch(snapshot.tree.toString(), /⚠/u);
            assert.equal([...snapshot.tokens()][0].kind, "OpenParen");
        }
    });

    // RETURN must continue to own a following parenthesized scalar subquery.
    test("keeps a grouped query after RETURN inside the return statement", () => {
        const snapshot = assertValid("RETURN (SELECT 1);");
        assert.match(
            snapshot.tree.toString(),
            /ReturnStatement\(Return,Expression\(ParenthesizedQuery\(/,
        );
        assert.doesNotMatch(snapshot.tree.toString(), /GroupedSelectStatement/);
    });

    // A line break does not turn a scalar subquery, derived table, or set operand into a statement.
    test("does not claim nested parenthesized queries", () => {
        for (const sql of [
            "SELECT\n (SELECT 1) AS x;",
            "SELECT * FROM (\n SELECT 1\n) d;",
            "IF EXISTS (\n SELECT 1\n) SELECT 1;",
            "SELECT 1\nUNION\n(SELECT 2);",
        ]) {
            const snapshot = assertValid(sql);
            assert.doesNotMatch(snapshot.tree.toString(), /GroupedQueryStatement/);
        }
    });

    // A damaged grouped query remains an error and cannot consume the following GO batch.
    test("bounds malformed grouped-query recovery to its batch", () => {
        const snapshot = parse("(SELECT FROM);\nGO\nSELECT 1;");
        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });

    // Replacing a scalar inside a grouped query must produce the same tree incrementally and fresh.
    test("keeps grouped-query incremental parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const before = "SELECT 0;\nGO\n(SELECT 1);";
        const previousDocument = document(1, before);
        const previousSnapshot = service.parse(previousDocument);
        const start = before.lastIndexOf("1");
        const { incremental } = assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start + 1, text: "2" }],
            // This tiny two-batch input is below the chunking threshold; equivalence is the gate.
            assertReuse: false,
        });
        assert.equal(incremental.statistics.rawErrorNodeCount, 0);
    });
});
