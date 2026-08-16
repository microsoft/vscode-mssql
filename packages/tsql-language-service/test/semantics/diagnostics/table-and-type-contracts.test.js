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

suite("T-SQL table and type contract diagnostics", () => {
    // Recognized legacy/current table hints stay valid; an arbitrary identifier is diagnosed at
    // the hint name without changing the permissive recovery grammar.
    test("validates table hint names", async () => {
        const provider = metadata({ objects: [table("items", "dbo", "Items")] });
        const diagnostics = await analyze(
            `SELECT * FROM dbo.Items WITH (NOLOCK, FORCESEEK, FORCE_ANN_ONLY);
             SELECT * FROM dbo.Items WITH (MADE_UP_HINT);`,
            provider,
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "InvalidTableHint")
                .map(({ message }) => message),
            [
                "MADE_UP_HINT is not a recognized table hints option. If it is intended as a parameter to a table-valued function, ensure that your database compatibility mode is set to 90.",
            ],
        );
    });
    // Table-valued functions require invocation and cannot be used as callable DML targets.
    test("validates function and non-table relation usage", async () => {
        const provider = metadata({
            objects: [
                {
                    ref: { id: "rows", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "Rows",
                    kind: "tableFunction",
                },
                {
                    ref: { id: "scalar", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "ScalarFn",
                    kind: "scalarFunction",
                },
            ],
        });
        const diagnostics = await analyze(
            `SELECT * FROM dbo.Rows;
             UPDATE dbo.Rows() SET Id = 1;
             UPDATE dbo.ScalarFn SET Id = 1;`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("Parameters were not supplied for the function 'dbo.Rows'."));
        assert.ok(
            output.some((message) =>
                message.startsWith("Function call cannot be used to match a target table"),
            ),
        );
        assert.ok(output.includes("Object 'dbo.ScalarFn' cannot be modified."));
    });
    // ORDER BY ordinal validation follows the select-list shape retained by Lezer.
    test("validates ORDER BY positions and constants", async () => {
        const provider = metadata({
            objects: [table("target", "dbo", "Target")],
            columns: new Map([["target", [{ name: "Id" }, { name: "Name" }]]]),
        });
        const diagnostics = await analyze(
            "DECLARE @position int; SELECT @position AS P, Name FROM dbo.Target ORDER BY 1, 3, 1 + 0;",
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes(
                "The SELECT item identified by the ORDER BY number 1 contains a variable as part of the expression identifying a column position. Variables are only allowed when ordering by an expression referencing a column name.",
            ),
        );
        assert.ok(
            output.includes(
                "The ORDER BY position number 3 is out of range of the number of items in the select list.",
            ),
        );
        assert.ok(
            output.includes(
                "A constant expression was encountered in the ORDER BY list, position 3.",
            ),
        );
    });
    // Type and column-option validation preserves SQL Server precision and IDENTITY diagnostics.
    test("validates data type bounds and incompatible column options", async () => {
        const diagnostics = await analyze(
            "CREATE TABLE dbo.Bad (A decimal(2,3), B varchar(9001), C nvarchar(5000), D int IDENTITY NULL DEFAULT 1);",
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("The scale must be less than or equal to the precision."));
        // Above the 8000-byte ceiling SQL Server reports the any-type message, not the per-type one.
        assert.ok(
            output.includes(
                "The size (9001) given to the type 'varchar' exceeds the maximum allowed for any data type (8000).",
            ),
        );
        assert.ok(
            output.includes(
                "The size (5000) given to the type 'nvarchar' exceeds the maximum allowed (4000).",
            ),
        );
        assert.ok(
            output.includes(
                "Could not create IDENTITY attribute on nullable column 'D', table 'dbo.Bad'.",
            ),
        );
        assert.ok(
            output.includes(
                "Defaults cannot be created on columns with an IDENTITY attribute. Table 'dbo.Bad', column 'D'.",
            ),
        );
    });
    // Type binding distinguishes system, alias, CLR, and table-valued types and applies parameter
    // READONLY rules only after the catalog or ordered local declaration resolves authoritatively.
    test("validates user-defined types and table-valued parameters", async () => {
        const provider = metadata({
            objects: [
                {
                    ref: { id: "alias", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "Code",
                    kind: "type",
                    typeCategory: "alias",
                },
                {
                    ref: { id: "rows", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "RowSet",
                    kind: "type",
                    typeCategory: "table",
                },
            ],
        });
        const diagnostics = await analyze(
            `CREATE TYPE dbo.Code FROM int;
             GO
             CREATE TYPE dbo.LocalRows AS TABLE (Id int);
             GO
             CREATE TABLE dbo.BadTypes (
                Missing dbo.DoesNotExist,
                InvalidTableColumn dbo.RowSet,
                ValidAlias dbo.Code,
                BadSeed int IDENTITY(N'bad', 1),
                BadIncrement int IDENTITY(1, @step)
             );
             GO
             CREATE PROCEDURE dbo.BadParameters
                @scalar int READONLY,
                @alias dbo.Code READONLY,
                @rows dbo.RowSet,
                @valid dbo.RowSet READONLY,
                @missing dbo.DoesNotExist
             AS SELECT 1;
             GO
             CREATE PROCEDURE dbo.LocalParameter @rows dbo.LocalRows AS SELECT 1;`,
            provider,
        );
        const codes = diagnostics.map(({ code }) => code);

        assert.equal(codes.filter((code) => code === "ColumnHasInvalidDataType").length, 1);
        assert.equal(codes.filter((code) => code === "ColumnHasUserDefinedTableType").length, 1);
        assert.equal(codes.filter((code) => code === "ParamVarHasInvalidDataType").length, 1);
        assert.equal(codes.filter((code) => code === "ParameterCannotBeReadOnly").length, 2);
        assert.equal(
            codes.filter((code) => code === "TableValuedParameterMustBeReadOnly").length,
            2,
        );
        assert.equal(codes.filter((code) => code === "InvalidSeed").length, 1);
        assert.equal(codes.filter((code) => code === "InvalidIncrement").length, 1);
        assert.equal(codes.filter((code) => code === "UserDefinedTypeExist").length, 1);
    });
    // Pending type metadata is not evidence that a user-defined type is missing.
    test("does not speculate about user-defined types while object metadata is incomplete", async () => {
        const diagnostics = await analyze(
            "CREATE TABLE dbo.Pending (Value custom.PendingType);",
            metadata({ completeness: { objects: "loading" } }),
        );

        assert.equal(
            diagnostics.some(({ code }) => code === "ColumnHasInvalidDataType"),
            false,
        );
    });
    // Alias types accept scalar system bases only, and COLLATE applies to character system types
    // rather than arbitrary scalar or user-defined columns.
    test("validates alias-type bases and COLLATE type compatibility", async () => {
        const diagnostics = await analyze(
            `CREATE TYPE dbo.XmlAlias FROM xml;
GO
CREATE TYPE dbo.AliasOfAlias FROM dbo.Code;
GO
CREATE TABLE dbo.CollationTypes (
    ValidText nvarchar(50) COLLATE Latin1_General_100_CI_AS,
    ValidSysname sysname COLLATE Latin1_General_100_CI_AS,
    InvalidNumber int COLLATE Latin1_General_100_CI_AS,
    InvalidAlias dbo.Code COLLATE Latin1_General_100_CI_AS
);`,
            metadata({
                objects: [
                    {
                        ref: { id: "alias", database: "db" },
                        database: "db",
                        schema: "dbo",
                        name: "Code",
                        kind: "type",
                        typeCategory: "alias",
                    },
                ],
            }),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InvalidBaseTypeForAlias",
                    message:
                        "The base type 'xml' is not a valid base type for the alias data type.",
                },
                {
                    code: "InvalidBaseTypeForAlias",
                    message:
                        "The base type 'dbo.Code' is not a valid base type for the alias data type.",
                },
                {
                    code: "ExpressionTypeInvalidForCollate",
                    message: "Expression type int is invalid for COLLATE clause.",
                },
                {
                    code: "CollateCannotBeUsedOnUddt",
                    message: "COLLATE clause cannot be used on user-defined data types.",
                },
            ],
        );
    });
    // Table constraints, sparse columns, and temporal period pairs are checked after structural parsing.
    test("validates advanced table column contracts", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE dbo.Constraints (
                A int NULL NULL,
                B int PRIMARY KEY UNIQUE,
                C int PRIMARY KEY,
                D int SPARSE NOT NULL,
                E int SPARSE NULL DEFAULT 1,
                F int SPARSE NULL UNIQUE,
                S1 xml COLUMN_SET FOR ALL_SPARSE_COLUMNS,
                S2 int COLUMN_SET FOR ALL_SPARSE_COLUMNS
            );
GO
CREATE TABLE dbo.Temporal (
    Started int GENERATED ALWAYS AS ROW START,
    StartedAgain datetime2 GENERATED ALWAYS AS ROW START,
    Ended datetime2 GENERATED ALWAYS AS ROW END,
    PERIOD FOR SYSTEM_TIME (WrongStart, Ended)
);`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes(
                "Multiple NULL constraints were specified for column 'A', table 'dbo.Constraints'.",
            ),
        );
        assert.ok(
            output.includes(
                "Both a PRIMARY KEY and UNIQUE constraint have been defined for column 'B', table 'dbo.Constraints'. Only one is allowed.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot add multiple PRIMARY KEY constraints to table 'dbo.Constraints'.",
            ),
        );
        assert.ok(
            output.some((message) => message.startsWith("Cannot create the sparse column 'D'")),
        );
        assert.ok(
            output.some((message) =>
                message.startsWith("A DEFAULT constraint cannot be created on the column 'E'"),
            ),
        );
        assert.ok(
            output.some((message) =>
                message.startsWith(
                    "Column 'F' in table 'dbo.Constraints' is of a type that is invalid for use as a key column",
                ),
            ),
        );
        assert.ok(
            output.some((message) =>
                message.startsWith("Cannot create the sparse column set 'S2'"),
            ),
        );
        assert.ok(
            output.some((message) =>
                message.startsWith("Temporal generated always column 'Started'"),
            ),
        );
        assert.ok(
            output.includes(
                "Table cannot have more than one 'GENERATED ALWAYS AS ROW START' column.",
            ),
        );
        assert.ok(
            output.some((message) =>
                message.startsWith("Table SYSTEM_TIME period definition start column name"),
            ),
        );
    });
    // Foreign keys bind both sides, infer primary keys, and compare cardinality and base types.
    test("validates foreign key table and column contracts", async () => {
        const provider = metadata({
            objects: [
                table("parent", "dbo", "Parent"),
                table("no-key", "dbo", "NoKey"),
                {
                    ref: { id: "parent-view", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "ParentView",
                    kind: "view",
                },
            ],
            columns: new Map([
                [
                    "parent",
                    [
                        { name: "Id", typeDisplay: "int", primaryKeyOrdinal: 1 },
                        { name: "Code", typeDisplay: "nvarchar(20)" },
                    ],
                ],
                ["no-key", [{ name: "Id", typeDisplay: "int" }]],
                ["parent-view", [{ name: "Id", typeDisplay: "int" }]],
            ]),
        });
        const diagnostics = await analyze(
            `CREATE TABLE dbo.Child (
    ParentId bigint,
    Existing int,
    CONSTRAINT FK_Bad FOREIGN KEY (Missing, ParentId)
        REFERENCES dbo.Parent (Id, MissingRef, Code),
    CONSTRAINT FK_Type FOREIGN KEY (ParentId) REFERENCES dbo.Parent (Id),
    CONSTRAINT FK_NoKey FOREIGN KEY (Existing) REFERENCES dbo.NoKey,
    CONSTRAINT FK_View FOREIGN KEY (Existing) REFERENCES dbo.ParentView (Id),
    CONSTRAINT FK_Missing FOREIGN KEY (Existing) REFERENCES dbo.MissingParent (Id)
);`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes(
                "Foreign key 'FK_Bad' references invalid column 'Missing' in referencing table 'Child'.",
            ),
        );
        assert.ok(
            output.includes(
                "Foreign key 'FK_Bad' references invalid column 'MissingRef' in referenced table 'dbo.Parent'.",
            ),
        );
        assert.ok(
            output.includes(
                "Number of referencing columns in foreign key differs from number of referenced columns, table 'Child'.",
            ),
        );
        assert.ok(
            output.includes(
                "Column 'dbo.Parent.Id' is not the same data type as referencing column 'Child.ParentId' in foreign key 'FK_Type'.",
            ),
        );
        assert.ok(
            output.includes(
                "Foreign key 'FK_NoKey' has implicit reference to object 'dbo.NoKey' which does not have a primary key defined on it.",
            ),
        );
        assert.ok(
            output.includes("Foreign key 'FK_View' references invalid table 'dbo.ParentView'."),
        );
        assert.ok(
            output.includes(
                "Foreign key 'FK_Missing' references invalid table 'dbo.MissingParent'.",
            ),
        );
    });
    // A table-level FOREIGN KEY must identify its local columns even when the referenced table
    // and referenced column list are otherwise valid.
    test("requires a referencing column list on table-level foreign keys", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE dbo.ParentWithKey (Id int PRIMARY KEY);
CREATE TABLE dbo.ChildWithoutList (
    Id int,
    CONSTRAINT FK_MissingList FOREIGN KEY REFERENCES dbo.ParentWithKey (Id)
);`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "TableConstraintHasNoColumnList",
                    message:
                        "Table level constraint does not specify column list, table 'ChildWithoutList'.",
                },
            ],
        );
    });
    // Valid explicit, implicit, self, and earlier-local-table references remain diagnostic-free.
    test("accepts valid catalog and document-local foreign keys", async () => {
        const provider = metadata({
            objects: [table("parent", "dbo", "Parent")],
            columns: new Map([
                ["parent", [{ name: "Id", typeDisplay: "int", primaryKeyOrdinal: 1 }]],
            ]),
        });
        const diagnostics = await analyze(
            `CREATE TABLE dbo.LocalParent (Id int PRIMARY KEY);
GO
CREATE TABLE dbo.Child (
    Id int PRIMARY KEY,
    ParentId int REFERENCES dbo.Parent,
    LocalParentId int REFERENCES dbo.LocalParent (Id),
    SelfParentId int REFERENCES dbo.Child (Id)
);`,
            provider,
        );
        assert.deepEqual(diagnostics, []);
    });
});
