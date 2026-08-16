/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// A function body may not change anything outside itself. SQL Server names the offending statement
// by its statement phrase.
const { createSemanticHarness } = require("../../support/semanticHarness.js");
const { analyze, open } = createSemanticHarness({ uri: "file:///function-body.sql" });

suite("T-SQL function body side-effect validation", () => {
    // The report names the statement phrase and covers the offending statement.
    test("rejects a side-effecting statement with exact output", async () => {
        const sql = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    CREATE TABLE dbo.T (Id int);
    RETURN 1;
END;`;
        const diagnostics = (await analyze(sql)).filter(
            ({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction",
        );

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "InvalidUseOfSideEffectingOperatorWithinFunction",
                    message:
                        "Invalid use of a side-effecting operator 'CREATE TABLE' within a function.",
                    severity: "error",
                    text: "CREATE TABLE dbo.T (Id int)",
                },
            ],
        );
    });

    // Each reported statement family is named by its own phrase.
    test("names each side-effecting statement family", async () => {
        for (const [statement, phrase] of [
            ["DROP TABLE dbo.T;", "DROP TABLE"],
            ["CREATE INDEX ix ON dbo.T (Id);", "CREATE INDEX"],
            ["CREATE VIEW dbo.v AS SELECT 1 AS Id;", "CREATE VIEW"],
            ["GRANT SELECT ON dbo.T TO public;", "GRANT"],
            ["SET NOCOUNT ON;", "SET"],
            ["DBCC CHECKDB;", "DBCC"],
            ["DROP SECURITY POLICY dbo.p;", "DROP SECURITY POLICY"],
        ]) {
            const sql = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    ${statement}
    RETURN 1;
END;`;
            assert.deepEqual(
                (await analyze(sql))
                    .filter(
                        ({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction",
                    )
                    .map(({ message }) => message),
                [`Invalid use of a side-effecting operator '${phrase}' within a function.`],
                statement,
            );
        }
    });

    // SELECT INTO creates a table, so it is a side effect rather than a data-returning SELECT.
    test("treats SELECT INTO as a side effect", async () => {
        const sql = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    SELECT 1 AS Id INTO dbo.NewTable;
    RETURN 1;
END;`;
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics
                .filter(({ code }) =>
                    [
                        "InvalidUseOfSideEffectingOperatorWithinFunction",
                        "SelectStatementWithinFunctionCannotReturnData",
                    ].includes(code),
                )
                .map(({ code, message }) => [code, message]),
            [
                [
                    "InvalidUseOfSideEffectingOperatorWithinFunction",
                    "Invalid use of a side-effecting operator 'SELECT' within a function.",
                ],
            ],
        );
    });

    // DML against a table variable is the supported way to build a result inside a function.
    test("allows table-variable DML and rejects DML on a table", async () => {
        const allowed = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    DECLARE @t TABLE (Id int);
    INSERT @t (Id) VALUES (1);
    DELETE @t;
    RETURN 1;
END;`;
        assert.deepEqual(
            (await analyze(allowed)).filter(
                ({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction",
            ),
            [],
        );

        const rejected = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    INSERT dbo.T (Id) VALUES (1);
    RETURN 1;
END;`;
        assert.deepEqual(
            (await analyze(rejected))
                .filter(({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction")
                .map(({ message }) => message),
            ["Invalid use of a side-effecting operator 'INSERT' within a function."],
        );
    });

    // An OUTPUT clause returns rows to the caller, which a function may not do; OUTPUT INTO a table
    // variable stays inside the function.
    test("rejects table-variable DML that produces output rows", async () => {
        const withOutput = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    DECLARE @t TABLE (Id int);
    INSERT @t (Id) OUTPUT inserted.Id VALUES (1);
    RETURN 1;
END;`;
        assert.deepEqual(
            (await analyze(withOutput))
                .filter(({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction")
                .map(({ message }) => message),
            ["Invalid use of a side-effecting operator 'INSERT' within a function."],
        );

        const outputIntoVariable = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    DECLARE @t TABLE (Id int);
    DECLARE @log TABLE (Id int);
    INSERT @t (Id) OUTPUT inserted.Id INTO @log VALUES (1);
    RETURN 1;
END;`;
        assert.deepEqual(
            (await analyze(outputIntoVariable)).filter(
                ({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction",
            ),
            [],
        );
    });

    // Control flow, declarations, assignments, and EXECUTE are not reported.
    test("leaves permitted function statements alone", async () => {
        const sql = `CREATE FUNCTION dbo.f(@n int) RETURNS int
AS
BEGIN
    DECLARE @i int = 0;
    SET @i = @n;
    IF @i > 1 SET @i = 1;
    WHILE @i > 0 SET @i = @i - 1;
    RETURN @i;
END;`;
        assert.deepEqual(
            (await analyze(sql)).filter(
                ({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction",
            ),
            [],
        );
    });

    // The rule belongs to function bodies; the same statements are fine in a procedure.
    test("does not apply inside a procedure body", async () => {
        const sql = `CREATE PROCEDURE dbo.p
AS
BEGIN
    CREATE TABLE dbo.T (Id int);
    SET NOCOUNT ON;
END;`;
        assert.deepEqual(
            (await analyze(sql)).filter(
                ({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction",
            ),
            [],
        );
    });

    // Recovery must not turn an incomplete statement into a confident semantic side-effect error.
    test("does not classify a damaged function statement", async () => {
        const sql = `CREATE FUNCTION dbo.f() RETURNS int
AS
BEGIN
    CREATE TABLE ;
    RETURN 1;
END;`;
        const snapshot = await open(sql);

        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(
                ({ code }) => code === "InvalidUseOfSideEffectingOperatorWithinFunction",
            ),
            [],
        );
    });
});
