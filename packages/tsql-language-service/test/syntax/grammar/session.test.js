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

    // SET STATISTICS accepts a comma-separated list of sub-options sharing one trailing ON/OFF,
    // matching SQL Server's SET STATISTICS IO, TIME ON form.
    test("parses a comma-separated SET STATISTICS option list", () => {
        const snapshot = parse("SET STATISTICS IO, TIME, PROFILE ON;");
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.equal((snapshot.tree.toString().match(/StatisticsOption\(/g) ?? []).length, 3);
    });

    // FIPS_FLAGGER is a repeated SET command: every comma-separated item carries its own level,
    // unlike NOCOUNT/ANSI_NULLS where one trailing ON/OFF applies to the complete name list.
    test("parses repeated FIPS_FLAGGER SET commands", () => {
        const snapshot = parse(
            "SET FIPS_FLAGGER OFF, FIPS_FLAGGER 'ENTRY', FIPS_FLAGGER 'INTERMEDIATE';",
        );
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.equal((snapshot.tree.toString().match(/FipsFlaggerSetCommand\(/g) ?? []).length, 3);
    });

    // ScriptDOM preserves the lexer boundary case of a bare @ in both a procedure parameter and
    // a DECLARE variable. Keep both declarations structured so the following AS/body is not lost.
    test("keeps bare variable markers structured in declarations", () => {
        const snapshot = parse(
            "CREATE PROCEDURE p1 @ AS INT AS BEGIN RETURN 0; END\nDECLARE @ AS INT;\nSELECT @3 + 1;",
        );
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /ProcedureParameter\(/);
        assert.match(snapshot.tree.toString(), /VariableDeclaration\(/);
    });

    // SET ERRLVL accepts a signed integer error level; whether the literal is actually an
    // integer is a validation rule, not a parse rule.
    test("parses SET ERRLVL values", () => {
        const snapshot = parse(`
SET ERRLVL 16;
SET ERRLVL -1;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.equal((snapshot.tree.toString().match(/SetStatement\(/g) ?? []).length, 2);
    });

    // SQL Server's on/off option list shares exactly one trailing toggle across every comma-joined
    // name (SET NOCOUNT, ANSI_NULLS ON), not one toggle per name.
    test("parses a comma-separated on/off SET option list with one shared toggle", () => {
        const snapshot = parse(`
SET NOCOUNT, ANSI_NULLS, QUOTED_IDENTIFIER ON;
SET ARITHABORT, ANSI_PADDING OFF;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.equal((snapshot.tree.toString().match(/SetStatement\(/g) ?? []).length, 2);
        assert.match(snapshot.tree.toString(), /SetOnOffOptionList\(/);
    });

    // A per-name toggle (SET NOCOUNT ON, ANSI_NULLS OFF) is not valid SQL Server syntax: the
    // trailing toggle applies once, to the whole list, so a comma after it starts an unexpected
    // continuation rather than a second option.
    test("rejects a per-name toggle inside an on/off SET option list", () => {
        const snapshot = parse("SET NOCOUNT ON, ANSI_NULLS OFF;");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // SQL Server's generic named-value SET options (DEADLOCK_PRIORITY, LOCK_TIMEOUT, LANGUAGE,
    // DATEFORMAT, DATEFIRST, QUERY_GOVERNOR_COST_LIMIT) share one option-name/value shape and may
    // be comma-joined across different names; the value is a literal, global variable, or bare
    // identifier, never a local variable or full expression.
    test("parses comma-separated generic SET option assignments", () => {
        const snapshot = parse(`
SET DEADLOCK_PRIORITY LOW, LOCK_TIMEOUT -1;
SET LANGUAGE us_english, DATEFORMAT ymd;
SET DATEFIRST 7, QUERY_GOVERNOR_COST_LIMIT 0;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.equal((snapshot.tree.toString().match(/SetStatement\(/g) ?? []).length, 3);
        assert.equal((snapshot.tree.toString().match(/SetGenericOption\(/g) ?? []).length, 6);
    });

    // TEXTSIZE, ERRLVL, and ROWCOUNT are dedicated single-value families and cannot be
    // comma-joined with a generic named-value option or with each other.
    test("rejects a dedicated single-value SET family joined by comma to a generic option", () => {
        const snapshot = parse("SET LOCK_TIMEOUT -1, TEXTSIZE -100;");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // A truncated second option stays in its batch so the following GO batch remains a clean SELECT.
    test("keeps a damaged comma-separated SET list inside its GO batch", () => {
        const sql = "SET LOCK_TIMEOUT -1,\nGO\nSELECT 1;";
        const snapshot = parse(sql);
        const selectStart = sql.indexOf("SELECT");
        const cleanSelect = parse("SELECT 1;");

        assert.ok(snapshot.diagnostics.length > 0);
        assert.ok(snapshot.diagnostics.every((diagnostic) => diagnostic.range.start < selectStart));
        assert.equal(cleanSelect.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(cleanSelect.diagnostics, []);
        assert.match(snapshot.tree.toString(), /SelectStatement\(/);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
    });

    // Incremental addition of a second generic SET option must match a fresh parse of the final text.
    test("keeps incremental comma-separated SET lists equivalent to a fresh parse", () => {
        const service = new LezerSyntaxService();
        const beforeText = "SET LOCK_TIMEOUT -1;\nGO\nSELECT 1;";
        const previousDocument = new ImmutableTextSnapshot(
            "file:///set-option-list.sql",
            1,
            beforeText,
        );
        const previousSnapshot = service.parse(previousDocument);
        const start = beforeText.indexOf(";");
        const { incremental, fresh } = assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start, text: ", DATEFIRST 7" }],
            assertReuse: false,
        });
        assert.deepEqual(incremental.diagnostics, []);
        assert.deepEqual(fresh.diagnostics, []);
        assert.equal((fresh.tree.toString().match(/SetGenericOption\(/g) ?? []).length, 2);
    });

    // SQL Server's DEADLOCK_PRIORITY accepts named and signed integer values through the generic
    // option value shape (a literal, global variable, local variable, or bare identifier).
    test("parses SET DEADLOCK_PRIORITY values", () => {
        const snapshot = parse(`
SET DEADLOCK_PRIORITY LOW;
SET DEADLOCK_PRIORITY NORMAL;
SET DEADLOCK_PRIORITY HIGH;
SET DEADLOCK_PRIORITY 5;
SET DEADLOCK_PRIORITY -5;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.equal((snapshot.tree.toString().match(/SetStatement\(/g) ?? []).length, 5);
        assert.equal((snapshot.tree.toString().match(/SetGenericOption\(/g) ?? []).length, 5);
        assert.match(snapshot.tree.toString(), /SetGenericOptionValue\(Minus,Literal/);
    });

    // A local variable is a valid generic SET option value (matches real-world usage such as
    // SET DEADLOCK_PRIORITY @priority); a '+' sign is not.
    test("parses a variable SET DEADLOCK_PRIORITY value and rejects a plus-signed one", () => {
        const snapshot = parse("SET DEADLOCK_PRIORITY @priority;");
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.ok(parse("SET DEADLOCK_PRIORITY +5;").diagnostics.length > 0);
    });

    // A truncated priority stays in its batch so the following GO batch remains a clean SELECT.
    test("keeps a damaged SET DEADLOCK_PRIORITY inside its GO batch", () => {
        const sql = "SET DEADLOCK_PRIORITY\nGO\nSELECT 1;";
        const snapshot = parse(sql);
        const selectStart = sql.indexOf("SELECT");
        const cleanSelect = parse("SELECT 1;");

        assert.ok(snapshot.diagnostics.length > 0);
        assert.ok(snapshot.diagnostics.every((diagnostic) => diagnostic.range.start < selectStart));
        assert.equal(cleanSelect.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(cleanSelect.diagnostics, []);
        assert.match(snapshot.tree.toString(), /SelectStatement\(/);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
    });

    // Incremental typing of the signed priority must match a fresh parse of the final text.
    test("keeps incremental SET DEADLOCK_PRIORITY equivalent to a fresh parse", () => {
        const service = new LezerSyntaxService();
        const beforeText = "SET DEADLOCK_PRIORITY 5;\nGO\nSELECT 1;";
        const previousDocument = new ImmutableTextSnapshot(
            "file:///deadlock-priority.sql",
            1,
            beforeText,
        );
        const previousSnapshot = service.parse(previousDocument);
        const start = beforeText.indexOf("5");
        const { incremental, fresh } = assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start + 1, text: "-5" }],
            assertReuse: false,
        });
        assert.deepEqual(incremental.diagnostics, []);
        assert.deepEqual(fresh.diagnostics, []);
        assert.match(fresh.tree.toString(), /SetGenericOptionValue\(Minus,Literal/);
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
EXECUTE AS LOGIN = N'test-user' WITH COOKIE INTO @cookie;
REVERT WITH COOKIE = @cookie;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /ExecuteAsCookieClause\(/);
        assert.match(snapshot.tree.toString(), /RevertCookieClause\(/);
    });

    // Session impersonation accepts CALLER directly and permits a scalar expression after
    // LOGIN/USER =, while malformed neighbours remain bounded to their own batch.
    test("parses complete EXECUTE AS principal forms", () => {
        const snapshot = parse(`
EXECUTE AS CALLER;
EXECUTE AS USER = dbo.fn_getuser();
EXECUTE AS LOGIN = @login_name;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/ExecuteAsStatement\(/g) ?? []).length, 3);

        for (const sql of [
            "EXECUTE AS CALLER = 'unexpected';",
            "EXECUTE AS USER;",
            "EXECUTE AS USER = dbo.fn_getuser(;",
        ]) {
            const damaged = parse(`${sql}\nGO\nSELECT 1;`);
            assert.ok(damaged.diagnostics.length > 0);
            assert.match(damaged.tree.toString(), /SelectStatement\(/);
        }
    });

    // Editing one impersonation form into another reuses the unaffected GO batch and matches a
    // fresh parse exactly.
    test("keeps EXECUTE AS incremental parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const before = "EXECUTE AS CALLER;\nGO\nSELECT 1;";
        const previousDocument = new ImmutableTextSnapshot("file:///execute-as.sql", 1, before);
        const previousSnapshot = service.parse(previousDocument);
        const start = before.indexOf("CALLER");
        assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [
                {
                    start,
                    end: start + "CALLER".length,
                    text: "USER = dbo.fn_getuser()",
                },
            ],
            assertReuse: false,
        });
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
