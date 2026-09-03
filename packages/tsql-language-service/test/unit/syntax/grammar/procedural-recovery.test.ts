/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} from "../../../../src/index.ts";

import { createSyntaxHarness, syntaxTree } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("procedural-recovery.sql");

suite("T-SQL procedural grammar", () => {
    // Verifies balanced WHILE and BEGIN/END produce real nodes without raw recovery errors.
    test("accepts a bounded WHILE block", () => {
        const snapshot = parse(`
DECLARE @i int = 0;
WHILE @i < 10
BEGIN
    PRINT CAST(@i AS nvarchar(10));
    SET @i = @i + 1;
END
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /WhileStatement\(/);
        assert.match(snapshot.tree.toString(), /BeginControlStatement\(/);
    });

    // Verifies IF/ELSE blocks can contain ordinary SQL and locally declared DDL.
    test("accepts balanced IF and ELSE blocks", () => {
        const snapshot = parse(`
IF OBJECT_ID(N'dbo.Items', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Items (Id int NOT NULL);
END
ELSE
BEGIN
    TRUNCATE TABLE dbo.Items;
END
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /IfStatement\(/);
    });

    // A semicolon-less IF body owns one statement; the next line remains a top-level sibling.
    test("does not absorb a following statement into an IF body", () => {
        const snapshot = parse("IF 1 = 1 SELECT 1\nSELECT 2");

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        const rootChildren = [...snapshot.root().children()];
        assert.equal(rootChildren.length, 1);
        const batch = rootChildren[0];
        assert.ok(batch);
        assert.equal(batch.kind, "Batch");
        const [firstStatement, secondStatement] = [...batch.children()];
        assert.ok(firstStatement);
        assert.ok(secondStatement);
        assert.equal([...batch.children()].length, 2);
        assert.equal(firstStatement.kind, "Statement");
        assert.equal(firstStatement.end, 17);
        assert.equal(secondStatement.kind, "Statement");
        assert.equal(secondStatement.start, 18);
    });

    // WHILE and ELSE bodies follow the same one-statement ownership rule as IF bodies.
    test("does not absorb following statements into WHILE or ELSE bodies", () => {
        for (const sql of [
            "WHILE 1 = 1 UPDATE dbo.T SET Value = 1\nSELECT 2",
            "IF 1 = 1 PRINT 'yes'\nELSE PRINT 'no'\nSELECT 2",
        ]) {
            const snapshot = parse(sql);
            assert.deepEqual(snapshot.diagnostics, []);
            assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
            const batch = [...snapshot.root().children()][0];
            assert.ok(batch);
            const [firstStatement, secondStatement] = [...batch.children()];
            assert.ok(firstStatement);
            assert.ok(secondStatement);
            assert.equal([...batch.children()].length, 2, sql);
            assert.equal(secondStatement.kind, "Statement", sql);
            assert.equal(sql.slice(secondStatement.start), "SELECT 2", sql);
        }
    });

    // Verifies TRY/CATCH and WAITFOR wrappers are recognized without weakening their SQL leaves.
    test("accepts TRY/CATCH and WAITFOR", () => {
        const snapshot = parse(`
BEGIN TRY
    WAITFOR DELAY '00:00:01';
    SELECT 1;
END TRY
BEGIN CATCH
    THROW;
END CATCH
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /BeginControlStatement\(Begin,Try/);
        assert.match(snapshot.tree.toString(), /WaitForStatement\(/);
    });

    // Verifies a procedure batch body no longer becomes a stream of false recovery errors.
    test("accepts a CREATE OR ALTER procedure batch", () => {
        const snapshot = parse(`
CREATE OR ALTER PROC dbo.Demo @value int = 1
AS
BEGIN
    IF @value > 0 PRINT @value;
    ELSE THROW 50000, N'bad value', 1;
END
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /CreateProcedureStatement\(/);
    });

    // Verifies function modules can contain a balanced multi-statement table-valued body.
    test("accepts a CREATE OR ALTER function batch", () => {
        const snapshot = parse(`
CREATE OR ALTER FUNCTION dbo.PositiveValues(@maximum int)
RETURNS @values TABLE (Value int NOT NULL)
AS
BEGIN
    DECLARE @value int = 1;
    WHILE @value <= @maximum
    BEGIN
        INSERT INTO @values VALUES (@value);
        SET @value += 1;
    END
    RETURN;
END
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /CreateFunctionStatement\(/);
    });

    // Verifies trigger modules and CTE-led statements are bounded to the current GO batch.
    test("accepts a trigger with a CTE-led body", () => {
        const snapshot = parse(`
CREATE OR ALTER TRIGGER dbo.ItemsChanged ON dbo.Items
AFTER INSERT
AS
BEGIN
    WITH Changed AS (SELECT Id FROM inserted)
    UPDATE target SET Value = Value + 1
    FROM dbo.Items AS target
    JOIN Changed AS source ON source.Id = target.Id;
END
GO
SELECT 1;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /CreateTriggerStatement\(/);
    });

    // Verifies missing structure remains diagnostic and is never treated as valid recovery.
    test("retains diagnostics for an unmatched BEGIN", () => {
        const snapshot = parse("WHILE 1 = 1 BEGIN SELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies malformed conditions remain visible through the mounted expression parser.
    test("retains diagnostics for a malformed IF condition", () => {
        const snapshot = parse("IF (1 + ) SELECT 1;");
        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near ')'.",
                severity: "error",
                range: { start: 8, end: 9 },
            },
        ]);
    });

    // Verifies invalid WAITFOR options remain errors rather than accepted wrapper text.
    test("retains diagnostics for an invalid WAITFOR option", () => {
        const snapshot = parse("WAITFOR BANANA;");
        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'BANANA'.",
                severity: "error",
                range: { start: 8, end: 14 },
            },
        ]);
    });

    // Verifies malformed leaf SQL inside a valid block still reports its exact reviewed error.
    test("retains malformed SQL leaf diagnostics", () => {
        const snapshot = parse("IF 1 = 1 BEGIN SELECT FROM dbo.Items; END");
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'FROM'.",
                severity: "error",
                range: { start: 22, end: 26 },
            },
        ]);
    });

    // Verifies procedural structure produces the same tree and diagnostics incrementally and fresh.
    test("keeps procedural incremental and fresh results equivalent", () => {
        const service = new LezerSyntaxService();
        const firstDocument = new ImmutableTextSnapshot(
            "file:///procedural.sql",
            1,
            "DECLARE @i int = 0; WHILE @i < 2 BEGIN SET @i = @i + 1; END",
        );
        const first = service.parse(firstDocument);
        const offset = firstDocument.text.indexOf("< 2") + 2;
        const change = { start: offset, end: offset + 1, text: "3" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.equal(syntaxTree(incremental), syntaxTree(fresh));
    });
});
