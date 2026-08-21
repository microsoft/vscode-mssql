/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { LezerSyntaxService } from "../../../../src/index.ts";
import { assertIncrementalEquivalent, createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, document, parse } = createSyntaxHarness("schema-elements.sql");

suite("T-SQL CREATE SCHEMA element grammar", () => {
    // The header may own object and permission statements that carry no terminator of their own.
    test("parses the schema elements SQL Server allows", () => {
        const snapshot = assertValid(`
CREATE SCHEMA Sales AUTHORIZATION dbo
    CREATE TABLE Invoice (Id int NOT NULL)
    CREATE VIEW OpenInvoice AS SELECT Id FROM Invoice
    GRANT SELECT ON Invoice TO Auditor
    DENY DELETE ON Invoice TO Auditor
    REVOKE INSERT ON Invoice FROM Auditor
`);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/SchemaElement\(/g) ?? []).length, 5);
        assert.equal((tree.match(/CreateSchemaStatement\(/g) ?? []).length, 1);
    });

    // Absorption is greedy exactly as the engine does it, so no terminator means one statement.
    test("absorbs a following CREATE TABLE that carries no terminator", () => {
        const tree = assertValid(
            "CREATE SCHEMA Sales CREATE TABLE Invoice (Id int)",
        ).tree.toString();
        assert.match(tree, /CreateSchemaStatement\(.*SchemaElement\(CreateTableStatement/su);
        assert.equal((tree.match(/Statement\(CreateTableStatement/g) ?? []).length, 0);
    });

    // A terminator ends the schema statement, so the next CREATE is a sibling statement again.
    test("stops at a statement terminator", () => {
        const tree = assertValid(
            "CREATE SCHEMA Sales; CREATE TABLE dbo.Invoice (Id int);",
        ).tree.toString();
        assert.equal((tree.match(/SchemaElement\(/g) ?? []).length, 0);
        assert.match(tree, /Statement\(CreateTableStatement/);
    });

    // A batch separator also ends the schema statement without producing recovery nodes.
    test("stops at a batch separator", () => {
        const snapshot = assertValid(`CREATE SCHEMA Sales
GO
CREATE TABLE dbo.Invoice (Id int)
`);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/SchemaElement\(/g) ?? []).length, 0);
        assert.equal(snapshot.statistics.batchCount, 2);
    });

    // A statement that cannot begin an element ends the header instead of being absorbed.
    test("ends the header before a statement that cannot be an element", () => {
        for (const sql of [
            "CREATE SCHEMA Sales\nSELECT 1",
            "CREATE SCHEMA Sales\nDROP TABLE dbo.Invoice",
            "CREATE SCHEMA Sales\nEXEC dbo.p",
        ]) {
            const tree = assertValid(sql).tree.toString();
            assert.equal((tree.match(/SchemaElement\(/g) ?? []).length, 0, sql);
        }
    });

    // CREATE commits to an element, so a CREATE outside the element set is a syntax error rather
    // than a second statement. This is the decision the engine's own parser makes on that lookahead.
    test("reports an unsupported CREATE element as a syntax error", () => {
        for (const sql of [
            "CREATE SCHEMA Sales\nCREATE PROCEDURE dbo.p AS SELECT 1",
            "CREATE SCHEMA Sales\nCREATE INDEX i ON dbo.t (a)",
        ]) {
            const snapshot = parse(sql);
            assert.ok(snapshot.diagnostics.length > 0, sql);
            assert.match(snapshot.tree.toString(), /CreateSchemaStatement\(/, sql);
        }
        // A terminator or batch separator keeps both statements, which is how scripts write them.
        assertValid("CREATE SCHEMA Sales;\nCREATE PROCEDURE dbo.p AS SELECT 1");
        assertValid("CREATE SCHEMA Sales\nGO\nCREATE INDEX i ON dbo.t (a)\n");
    });

    // Incomplete typing stays visible as recovery instead of silently reshaping the statement.
    test("keeps incomplete element input visible", () => {
        const snapshot = parse("CREATE SCHEMA Sales CREATE TABLE");
        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.match(snapshot.tree.toString(), /CreateSchemaStatement\(/);
    });

    // Recovery inside one element does not consume the statements that follow the batch.
    test("recovers from a damaged element without losing the next batch", () => {
        const snapshot = parse(`CREATE SCHEMA Sales CREATE TABLE Invoice (
GO
SELECT 1;
`);
        assert.equal(snapshot.statistics.batchCount, 2);
        assert.match(snapshot.tree.toString(), /SelectStatement\(/);
    });

    // Incremental parsing of the same final text must equal a fresh parse.
    test("keeps incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const first = `SELECT 1;
GO
CREATE SCHEMA Sales
    CREATE TABLE Invoice (Id int)
GO
SELECT 2;
`;
        const previousDocument = document(1, first);
        const previousSnapshot = service.parse(previousDocument);
        assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            // This script is one safe batch group, so the edit reparses it; the invariant under
            // test is that the incremental tree, diagnostics, and tokens equal a fresh parse.
            assertReuse: false,
            changes: [
                {
                    start: first.indexOf("(Id int)"),
                    end: first.indexOf("(Id int)") + "(Id int)".length,
                    text: "(Id int, Total money)",
                },
            ],
        });
    });
});
