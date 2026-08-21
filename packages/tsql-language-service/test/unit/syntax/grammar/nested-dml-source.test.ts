/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { LezerSyntaxService } from "../../../../src/index.ts";
import { assertIncrementalEquivalent, createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, document, parse } = createSyntaxHarness("nested-dml-source.sql");

suite("T-SQL nested DML table source grammar", () => {
    // Each DML statement keeps its own node inside the table source, alias, and column list.
    test("parses every nested DML statement form", () => {
        const tree = assertValid(`
SELECT * FROM (INSERT dbo.Orders (Id) OUTPUT inserted.Id VALUES (1)) AS a (Id);
SELECT * FROM (UPDATE dbo.Orders SET Id = 1 OUTPUT inserted.Id) AS b (Id);
SELECT * FROM (DELETE dbo.Orders OUTPUT deleted.Id) AS c (Id);
SELECT * FROM (MERGE dbo.Orders AS t USING dbo.Orders AS s ON t.Id = s.Id
    WHEN MATCHED THEN DELETE OUTPUT deleted.Id;) AS d (Id);
`).tree.toString();
        assert.equal((tree.match(/NestedDmlTableSource\(/g) ?? []).length, 4);
        for (const statement of [
            "InsertStatement",
            "UpdateStatement",
            "DeleteStatement",
            "MergeStatement",
        ]) {
            assert.match(tree, new RegExp(`NestedDmlTableSource\\(OpenParen,${statement}\\(`));
        }
    });

    // The alias is required, so a parenthesized query without one stays an ordinary table source.
    test("leaves ordinary parenthesized sources unchanged", () => {
        const tree = assertValid(`
SELECT * FROM (SELECT Id FROM dbo.Orders) AS x;
SELECT * FROM (dbo.Orders AS y);
SELECT * FROM (VALUES (1)) AS v (Id);
`).tree.toString();
        assert.equal((tree.match(/NestedDmlTableSource\(/g) ?? []).length, 0);
        assert.match(tree, /DerivedTable\(/);
        assert.match(tree, /ParenthesizedTableSource\(/);
        assert.match(tree, /TableValueConstructor\(/);
    });

    // A top-level DML statement is not a table source and keeps its ordinary shape.
    test("does not change a top-level DML statement", () => {
        const tree = assertValid(
            "INSERT dbo.Orders (Id) OUTPUT inserted.Id VALUES (1);",
        ).tree.toString();
        assert.equal((tree.match(/NestedDmlTableSource\(/g) ?? []).length, 0);
        assert.match(tree, /Statement\(InsertStatement\(/);
    });

    // Incomplete typing stays visible as recovery rather than reshaping the query.
    test("keeps incomplete nested input visible", () => {
        for (const sql of [
            "SELECT * FROM (INSERT dbo.Orders",
            "SELECT * FROM (DELETE dbo.Orders OUTPUT deleted.Id)",
        ]) {
            const snapshot = parse(sql);
            assert.ok(snapshot.statistics.rawErrorNodeCount > 0, sql);
            assert.match(snapshot.tree.toString(), /SelectStatement\(/, sql);
        }
    });

    // Recovery inside the nested statement does not swallow the statements that follow it. An
    // unbalanced parenthesis keeps the batch open, which is the parser's existing behaviour, so the
    // following statement stays visible inside that batch rather than being discarded.
    test("recovers without losing the following statements", () => {
        const snapshot = parse(`SELECT * FROM (INSERT dbo.Orders (
GO
SELECT 1;
`);
        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        // The trailing query is still represented rather than discarded by recovery.
        assert.ok((snapshot.tree.toString().match(/QuerySpecification\(/g) ?? []).length >= 2);
        // A balanced but incomplete nested statement keeps the batch separator working.
        const balanced = parse(`SELECT * FROM (INSERT dbo.Orders (Id))
GO
SELECT 1;
`);
        assert.equal(balanced.statistics.batchCount, 2);
    });

    // Incremental parsing of the same final text must equal a fresh parse.
    test("keeps incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const first = `SELECT 1;
GO
SELECT * FROM (DELETE dbo.Orders OUTPUT deleted.Id) AS x (Id);
GO
SELECT 2;
`;
        const previousDocument = document(1, first);
        assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot: service.parse(previousDocument),
            version: 2,
            // The script is one safe batch group, so the invariant under test is that the
            // incremental tree, diagnostics, and tokens equal a fresh parse.
            assertReuse: false,
            changes: [
                {
                    start: first.indexOf(" OUTPUT deleted.Id"),
                    end: first.indexOf(" OUTPUT deleted.Id") + " OUTPUT deleted.Id".length,
                    text: "",
                },
            ],
        });
    });
});
