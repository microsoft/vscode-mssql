/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    analyzeSql: analyze,
    createMetadata: metadata,
    messages,
    table,
} = require("../../support/semanticHarness.js");

suite("T-SQL DDL and programmable module diagnostics", () => {
    // CREATE/ALTER/DROP use the pinned catalog and schema list while local DDL stays ordered.
    test("validates DDL object and schema existence", async () => {
        const provider = metadata({
            objects: [table("existing", "dbo", "Existing")],
            schemas: [{ database: "db", name: "dbo" }],
        });
        const diagnostics = await analyze(
            `CREATE TABLE dbo.Existing (Id int);
             CREATE TABLE missing.NewTable (Id int);
GO
             ALTER VIEW dbo.Unknown AS SELECT 1 AS Id;
GO
             DROP TABLE dbo.Unknown;`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes("There is already an object named 'dbo.Existing' in the database."),
        );
        assert.ok(
            output.includes(
                ' The specified schema name "missing" either does not exist or you do not have permission to use it.',
            ),
        );
        assert.ok(
            output.includes(
                "Cannot perform alter on 'dbo.Unknown' because it is an incompatible object type.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot drop the table 'dbo.Unknown', because it does not exist or you do not have permission.",
            ),
        );
    });
    // CREATE OR ALTER reuses an existing module instead of reporting the duplicate-object error
    // that a plain CREATE must produce.
    test("accepts CREATE OR ALTER for existing programmable objects", async () => {
        const provider = metadata({
            objects: [
                {
                    ref: { id: "existing-procedure", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "ExistingProcedure",
                    kind: "procedure",
                },
                {
                    ref: { id: "existing-view", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "ExistingView",
                    kind: "view",
                },
                {
                    ref: { id: "existing-function", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "ExistingFunction",
                    kind: "scalarFunction",
                },
            ],
            schemas: [{ database: "db", name: "dbo" }],
        });
        const diagnostics = await analyze(
            `CREATE OR ALTER PROCEDURE dbo.ExistingProcedure AS SELECT 1;
GO
CREATE OR ALTER VIEW dbo.ExistingView AS SELECT 1 AS Id;
GO
CREATE OR ALTER FUNCTION dbo.ExistingFunction() RETURNS int AS BEGIN RETURN 1; END;`,
            provider,
        );

        assert.ok(
            !diagnostics.some(({ code }) => code === "DatabaseObjectExist"),
            messages(diagnostics).join("\n"),
        );
    });
    // Module definitions are structurally valid but must remain isolated in their SQL batch.
    test("requires module definitions to be the only statement in a batch", async () => {
        const diagnostics = await analyze(
            "CREATE VIEW dbo.v AS SELECT 1 AS Id; SELECT 2;",
            metadata(),
        );
        assert.ok(
            messages(diagnostics).includes(
                "Incorrect syntax: 'CREATE VIEW' must be the only statement in the batch.",
            ),
        );
        assert.deepEqual(
            await analyze("CREATE VIEW dbo.v AS SELECT 1 AS Id;\nGO\nSELECT 2;", metadata()),
            [],
        );
    });
    // Programmable-object names, procedure group numbers, function options, and view options are
    // validated from their structured definition nodes without relying on catalog metadata.
    test("validates programmable-object definition contracts", async () => {
        const diagnostics = await analyze(
            `CREATE PROCEDURE db.dbo.BadProcedure;0 AS SELECT 1;
GO
CREATE FUNCTION db.dbo.BadFunction()
RETURNS int
WITH RETURNS NULL ON NULL INPUT, CALLED ON NULL INPUT
AS BEGIN RETURN 1; END;
GO
CREATE FUNCTION dbo.#TemporaryFunction() RETURNS int AS BEGIN RETURN 1; END;
GO
CREATE VIEW db.dbo.BadView WITH RECOMPILE AS SELECT 1 AS Id;`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes(
                "CREATE/ALTER PROCEDURE' does not allow specifying the database name as a prefix to the object name.",
            ),
        );
        assert.ok(output.includes("Invalid procedure number 0.Must be between 1 and 32767."));
        assert.ok(
            output.includes(
                "CREATE/ALTER FUNCTION' does not allow specifying the database name as a prefix to the object name.",
            ),
        );
        assert.ok(
            output.includes(
                'Conflicting CREATE/ALTER FUNCTION options "RETURNS NULL ON NULL INPUT" and "CALLED ON NULL INPUT".',
            ),
        );
        assert.ok(output.includes("Creation of temporary functions is not allowed."));
        assert.ok(
            output.includes(
                "'CREATE/ALTER VIEW' does not allow specifying the database name as a prefix to the object name.",
            ),
        );
        assert.ok(
            output.includes(
                'An invalid option was specified for the statement "CREATE/ALTER VIEW".',
            ),
        );
        assert.equal(
            output.some((message) => message.includes("Database 'db' does not exist")),
            false,
        );
    });
    // Function options depend on whether the body is scalar, inline-table, multi-statement table,
    // or external; accepting the token syntactically must not imply it is valid for every shape.
    test("validates function options for each body shape", async () => {
        const diagnostics = await analyze(
            `CREATE FUNCTION dbo.BadInline() RETURNS TABLE WITH EXECUTE AS CALLER AS RETURN SELECT 1 AS Id;
GO
CREATE FUNCTION dbo.BadScalar() RETURNS int WITH NATIVE_COMPILATION AS RETURN 1;
GO
CREATE FUNCTION dbo.BadClr() RETURNS int WITH ENCRYPTION AS EXTERNAL NAME a.b.c;`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "InvalidOptionInCreateFunction")
                .map(({ message }) => message),
            [
                'An invalid option was specified for the statement "CREATE/ALTER FUNCTION".',
                'An invalid option was specified for the statement "CREATE/ALTER FUNCTION".',
                'An invalid option was specified for the statement "CREATE/ALTER FUNCTION".',
            ],
        );
    });
    // Structured function bodies distinguish scalar/table RETURN contracts, require a final
    // top-level RETURN, and allow SELECT only when every item assigns a local variable.
    test("validates function body return and SELECT contracts", async () => {
        const diagnostics = await analyze(
            `CREATE FUNCTION dbo.MissingValue() RETURNS int AS BEGIN SELECT 1; RETURN; END;
GO
CREATE FUNCTION dbo.MissingFinal(@x int) RETURNS int AS BEGIN RETURN 1; SELECT @x = 1; END;
GO
CREATE FUNCTION dbo.TableValue() RETURNS @t TABLE(Id int) AS BEGIN RETURN 1; END;`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) =>
                    [
                        "LastStatementWithinFunctionMustBeReturn",
                        "ReturnStatementInScalarValuedFunctionMustIncludeArg",
                        "UseReturnStatementWithValueCannotBeUsed",
                        "SelectStatementWithinFunctionCannotReturnData",
                    ].includes(code),
                )
                .map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "SelectStatementWithinFunctionCannotReturnData",
                    message:
                        "Select statements included within a function cannot return data to a client.",
                },
                {
                    code: "ReturnStatementInScalarValuedFunctionMustIncludeArg",
                    message:
                        "RETURN statements in scalar valued functions must include an argument.",
                },
                {
                    code: "LastStatementWithinFunctionMustBeReturn",
                    message:
                        "The last statement included within a function must be a return statement.",
                },
                {
                    code: "UseReturnStatementWithValueCannotBeUsed",
                    message:
                        " A RETURN statement with a return value cannot be used in this context.",
                },
            ],
        );
    });
    // Common built-ins retain SQL Server-compatible arity and date-part messages.
    test("validates built-in function arguments", async () => {
        const diagnostics = await analyze(
            "SELECT ABS(), GETDATE(1), COALESCE(1), DATEADD(nonsense, 1, GETDATE()), DATEPART(1, GETDATE()), ISJSON(N'{}', BANANA);",
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes(" The ABS function takes exactly 1 argument."));
        assert.ok(output.includes("The function 'GETDATE' takes exactly 0 arguments."));
        assert.ok(output.includes("Function 'COALESCE' requires at least 2 arguments."));
        assert.ok(output.includes("'nonsense' is not a recognized DATEADD option."));
        assert.ok(output.includes("Invalid parameter 1 specified for DATEPART."));
        assert.ok(output.includes("'BANANA' is not a recognized ISJSON option."));
    });
    // Module/login options and CAST targets use the same reusable option/type validators.
    test("validates duplicate options, option order, and system CAST types", async () => {
        const diagnostics = await analyze(
            `SELECT CAST(1 AS dbo.CustomType);
GO
CREATE PROCEDURE dbo.p WITH ENCRYPTION, ENCRYPTION AS SELECT 1;
GO
CREATE VIEW dbo.v WITH MADE_UP AS SELECT 1 AS Id;
GO
CREATE LOGIN test_login WITH PASSWORD = 0x123 MUST_CHANGE HASHED;`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("Type 'dbo.CustomType' is not a defined system type."));
        assert.ok(output.includes("Option 'ENCRYPTION' is specified more than once."));
        assert.ok(output.includes("'MADE_UP' is not a recognized option."));
        assert.ok(output.includes("'HASHED' is specified at incorrect location."));
    });
});
