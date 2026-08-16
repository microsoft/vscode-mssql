/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("session.sql");

suite("T-SQL batch and session grammar", () => {
    // Verifies scalar and table-variable declarations preserve types and initializers.
    test("parses DECLARE variables", () => {
        const snapshot = parse(`
DECLARE @count int = 1, @name nvarchar(100) = N'test';
DECLARE @rows TABLE (Id int PRIMARY KEY, Payload json NULL);
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/DeclareStatement\(/g) ?? []).length, 2);
    });

    // Verifies supported SET option families reject neither valid ON/OFF nor isolation syntax.
    test("parses validated SET option families", () => {
        const snapshot = parse(`
SET NOCOUNT ON;
SET ANSI_NULLS OFF;
SET LOCK_TIMEOUT 5000;
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
SET IDENTITY_INSERT dbo.Target ON;
SET STATISTICS IO ON;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/SetStatement\(/g) ?? []).length, 6);
    });

    // Verifies BEGIN/SAVE/COMMIT/ROLLBACK transaction forms and delayed durability.
    test("parses transaction statements", () => {
        const snapshot = parse(`
BEGIN TRANSACTION work;
SAVE TRANSACTION before_change;
COMMIT TRANSACTION work WITH (DELAYED_DURABILITY = ON);
ROLLBACK TRANSACTION work;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /BeginTransactionStatement\(/);
        assert.match(tree, /DelayedDurabilityClause\(/);
        assert.match(tree, /RollbackTransactionStatement\(/);
    });

    // Verifies session EXECUTE AS and REVERT cookies are not confused with EXEC procedure calls.
    test("parses EXECUTE AS and REVERT", () => {
        const snapshot = parse(`
EXECUTE AS LOGIN = N'test-user' WITH NO REVERT COOKIE INTO @cookie;
REVERT WITH COOKIE = @cookie;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /ExecuteAsCookieClause\(/);
        assert.match(snapshot.tree.toString(), /RevertCookieClause\(/);
    });

    // Verifies message, error, database, truncate, and checkpoint statements have explicit nodes.
    test("parses common batch utility statements", () => {
        const snapshot = parse(`
PRINT N'start';
RAISERROR(N'warning', 10, 1) WITH NOWAIT;
THROW 50000, N'failure', 1;
USE tempdb;
TRUNCATE TABLE dbo.Stage;
CHECKPOINT 10;
RETURN 0;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        for (const kind of [
            "PrintStatement",
            "RaiserrorStatement",
            "ThrowStatement",
            "UseStatement",
            "TruncateTableStatement",
            "CheckpointStatement",
            "ReturnStatement",
        ]) {
            assert.match(tree, new RegExp(`${kind}\\(`));
        }
    });
});
