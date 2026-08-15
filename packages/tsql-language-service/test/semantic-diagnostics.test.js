/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../dist/index.js");

suite("T-SQL semantic diagnostics", () => {
    // A complete catalog is authoritative for unresolved read and DML targets.
    test("reports missing catalog objects and procedures without guessing on pending metadata", async () => {
        const closed = await analyze(
            "SELECT * FROM dbo.Missing; INSERT dbo.Missing(Id) VALUES (1); EXEC dbo.MissingProc;",
            metadata(),
        );
        assert.deepEqual(messages(closed), [
            "Invalid object name 'dbo.Missing'.",
            "Invalid object name 'dbo.Missing'.",
            "Could not find stored procedure 'dbo.MissingProc'.",
        ]);

        const pending = await analyze(
            "SELECT * FROM dbo.Missing;",
            metadata({ completeness: { objects: "loading" } }),
        );
        assert.deepEqual(pending, []);
    });

    // Local DDL follows execution order across GO instead of becoming globally visible.
    test("tracks CREATE and DROP visibility by source offset", async () => {
        const sql = `
SELECT * FROM dbo.Work;
CREATE TABLE dbo.Work (Id int);
GO
SELECT Id FROM dbo.Work;
DROP TABLE dbo.Work;
SELECT * FROM dbo.Work;`;
        const diagnostics = await analyze(sql, metadata({ schemas: [{ name: "dbo" }] }));
        assert.deepEqual(
            diagnostics.filter(({ code }) => code === "MSSQL208").map(({ message }) => message),
            ["Invalid object name 'dbo.Work'.", "Invalid object name 'dbo.Work'."],
        );
        assert.equal(diagnostics.some(({ message }) => message.includes("Invalid column")), false);
    });

    // Views and table-valued functions participate in the same ordered local relation timeline,
    // and a local DROP must override an older pinned-catalog object.
    test("tracks document-local views, table functions, and stale catalog drops", async () => {
        const provider = metadata({
            schemas: [{ database: "db", name: "dbo" }],
            objects: [table("catalog-work", "dbo", "CatalogWork")],
            columns: new Map([
                ["catalog-work", [{ name: "Id", typeDisplay: "int" }]],
            ]),
        });
        const diagnostics = await analyze(
            `CREATE OR ALTER VIEW dbo.LocalView (ViewId) AS SELECT 1 AS Id;
GO
SELECT ViewId FROM dbo.LocalView;
GO
CREATE OR ALTER FUNCTION dbo.LocalRows() RETURNS TABLE AS RETURN (SELECT 1 AS ItemId);
GO
SELECT f.ItemId FROM dbo.LocalRows() AS f;
GO
DROP VIEW dbo.LocalView;
SELECT * FROM dbo.LocalView;
DROP TABLE dbo.CatalogWork;
SELECT * FROM dbo.CatalogWork;`,
            provider,
        );

        assert.deepEqual(
            diagnostics.filter(({ code }) => code === "MSSQL208").map(({ message }) => message),
            [
                "Invalid object name 'dbo.LocalView'.",
                "Invalid object name 'dbo.CatalogWork'.",
            ],
        );
        assert.equal(diagnostics.some(({ code }) => code === "MSSQL207"), false);
    });

    // Other relation-producing statements become visible only after their statement, while an
    // unknown synonym shape remains non-authoritative instead of creating phantom column errors.
    test("tracks local SELECT INTO, external tables, and synonyms", async () => {
        const diagnostics = await analyze(
            `SELECT 1 AS IntoId INTO dbo.IntoRows;
GO
SELECT IntoId FROM dbo.IntoRows;
GO
CREATE EXTERNAL TABLE dbo.ExternalRows (ExternalId int)
WITH (LOCATION = '/rows', DATA_SOURCE = SourceName);
GO
SELECT ExternalId FROM dbo.ExternalRows;
GO
CREATE SYNONYM dbo.LocalSynonym FOR remoteDb.dbo.RemoteRows;
GO
SELECT UnknownRemoteColumn FROM dbo.LocalSynonym;`,
            metadata({ schemas: [{ database: "db", name: "dbo" }] }),
        );

        assert.deepEqual(
            diagnostics.filter(({ code }) => ["MSSQL207", "MSSQL208"].includes(code)),
            [],
        );
    });

    // Loaded source shapes support invalid, ambiguous, and prefix diagnostics.
    test("validates qualified and unqualified column references", async () => {
        const provider = metadata({
            objects: [table("customers", "dbo", "Customers"), table("orders", "sales", "Orders")],
            columns: new Map([
                ["customers", [{ name: "Id", typeDisplay: "int" }]],
                ["orders", [{ name: "Id", typeDisplay: "int" }]],
            ]),
        });
        const diagnostics = await analyze(
            `SELECT Missing FROM dbo.Customers;
             SELECT Id FROM dbo.Customers c JOIN sales.Orders o ON c.Id = o.Id;
             SELECT z.Id, c.Nope FROM dbo.Customers c;`,
            provider,
        );
        assert.deepEqual(messages(diagnostics), [
            "Invalid column name 'Missing'.",
            "Ambiguous column name 'Id'.",
            "The column prefix 'z' does not match with a table name or alias name used in the query.",
            "Invalid column name 'Nope'.",
        ]);
    });

    // SELECT variable assignment cannot be mixed with result-producing expressions, while a
    // statement containing only assignments remains valid.
    test("validates SELECT assignment and data-retrieval mixing", async () => {
        const provider = metadata({
            objects: [table("items", "dbo", "Items")],
            columns: new Map([
                [
                    "items",
                    [
                        { name: "Id", typeDisplay: "int" },
                        { name: "Name", typeDisplay: "nvarchar(100)" },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            `DECLARE @id int, @name nvarchar(100);
             SELECT @id = Id, Name FROM dbo.Items;
             SELECT @id = Id, @name = Name FROM dbo.Items;`,
            provider,
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "SelectAssignmentError")
                .map(({ message }) => message),
            [
                "A SELECT statement that assigns a value to a variable must not be combined with data-retrieval operations.",
            ],
        );
    });

    // INTO belongs only to the leading query term of a UNION/INTERSECT/EXCEPT expression.
    test("validates SELECT INTO placement in set queries", async () => {
        const diagnostics = await analyze(
            `SELECT 1 AS Id UNION ALL SELECT 2 INTO dbo.InvalidTarget;
             SELECT 1 INTO dbo.ValidTarget UNION ALL SELECT 2;`,
            metadata({ schemas: [{ name: "dbo" }] }),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "SelectIntoMustBeFirstQuery")
                .map(({ message }) => message),
            [
                "SELECT INTO must be the first query in a statement containing a UNION, INTERSECT or EXCEPT operator.",
            ],
        );
    });

    // Batch-local declarations and FROM exposed names retain SQL Server duplicate-name behavior.
    test("validates variables, exposed names, and table column declarations", async () => {
        const provider = metadata({
            objects: [
                table("customers", "dbo", "Customers"),
                table("orders", "dbo", "Orders"),
                table("sales-customers", "sales", "Customers"),
            ],
        });
        const diagnostics = await analyze(
            `DECLARE @id int; DECLARE @id int; SELECT @missing;
             SELECT * FROM dbo.Customers x JOIN dbo.Orders x ON 1 = 1;
             SELECT * FROM dbo.Customers Orders JOIN dbo.Orders ON 1 = 1;
             SELECT * FROM dbo.Customers JOIN sales.Customers ON 1 = 1;
             CREATE TABLE dbo.Bad (Id int, Id bigint);`,
            provider,
        );
        assert.ok(
            messages(diagnostics).includes(
                "The variable name '@id' has already been declared.Variable names must be unique within a query batch or stored procedure.",
            ),
        );
        assert.ok(messages(diagnostics).includes('Must declare the scalar variable "@missing".'));
        assert.ok(
            messages(diagnostics).includes(
                "The correlation name 'x' is specified multiple times in a FROM clause.",
            ),
        );
        assert.ok(
            messages(diagnostics).includes(
                "The correlation name 'Orders' has the same exposed name as table 'Orders'.",
            ),
        );
        assert.ok(
            messages(diagnostics).includes(
                'The objects "Customers" and "Customers" in the FROM clause have the same exposed names. Use correlation names to distinguish them.',
            ),
        );
        assert.ok(
            messages(diagnostics).includes("Column names in each table must be unique. Column name 'Id' in table 'dbo.Bad' is specified more than once."),
        );
    });

    // A recovered column declaration still owns enough structure for the binder to provide the
    // specific missing-type diagnostic in addition to the parser's local recovery diagnostic.
    test("reports a missing column data type from a recovered table definition", async () => {
        const diagnostics = await analyze(
            "CREATE TABLE dbo.Bad (MissingType);",
            metadata(),
            { allowSyntaxDiagnostics: true },
        );

        assert.deepEqual(
            diagnostics.filter(({ code }) => code === "DataTypeMissing").map(({ message }) => message),
            ["The definition for column 'MissingType' must include a data type."],
        );
    });

    // Empty quoted identifiers are syntactically lossless but cannot name an object or result
    // column, so binding reports the actionable object/column-name diagnostic at each alias.
    test("rejects empty quoted object and column names", async () => {
        const diagnostics = await analyze(
            'SELECT 1 AS [], 2 AS ""; CREATE TABLE dbo.[] (Id int);',
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "ObjectNameIsMissingOrEmpty")
                .map(({ message }) => message),
            Array(3).fill(
                'An object or column name is missing or empty. For SELECT INTO statements, verify each column has a name. For other statements, look for empty alias names. Aliases defined as "" or [] are not allowed. Change the alias to a valid name.',
            ),
        );
    });

    // CTE binding distinguishes duplicate names, missing anchors, and invalid recursive members.
    test("validates common table expression binding", async () => {
        const diagnostics = await analyze(
            `WITH d AS (SELECT 1 AS Id), d AS (SELECT 2 AS Id) SELECT * FROM d;
             WITH no_union AS (SELECT * FROM no_union) SELECT * FROM no_union;
             WITH no_anchor AS (SELECT * FROM no_anchor UNION ALL SELECT * FROM no_anchor) SELECT * FROM no_anchor;
             WITH multiple_refs AS (
                 SELECT 1 AS Id
                 UNION ALL
                 SELECT a.Id FROM multiple_refs a JOIN multiple_refs b ON a.Id = b.Id
             ) SELECT * FROM multiple_refs;
             WITH late_anchor AS (
                 SELECT 1 AS Id
                 UNION ALL
                 SELECT Id FROM late_anchor
                 UNION ALL
                 SELECT 2 AS Id
             ) SELECT * FROM late_anchor;`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("Duplicate common table expression name 'd' was specified."));
        assert.ok(output.includes("Recursive common table expression 'no_union' does not contain a top-level UNION ALL operator."));
        assert.ok(output.includes('No anchor member was specified for recursive query "no_anchor".'));
        assert.ok(output.includes("Recursive member of a common table expression 'multiple_refs' has multiple recursive references."));
        assert.ok(output.includes('An anchor member was found in the recursive part of recursive query "late_anchor".'));
    });

    // Projected rowsets must match explicit column-list cardinality and name unnamed expressions.
    test("validates projected relation column shapes", async () => {
        const diagnostics = await analyze(
            `WITH c_more(a) AS (SELECT 1, 2) SELECT * FROM c_more;
WITH c_fewer(a, b) AS (SELECT 1) SELECT * FROM c_fewer;
WITH c_missing AS (SELECT 1, 2 AS Named) SELECT * FROM c_missing;
SELECT * FROM (SELECT 1, 2) AS derived(a);
GO
CREATE VIEW dbo.v_missing AS SELECT 1;`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => ["MoreColumns", "FewerColumns", "MissingColumn"].includes(code))
                .map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "MoreColumns",
                    message: "'c_more' has more columns than specified in the column list.",
                },
                {
                    code: "FewerColumns",
                    message: "'c_fewer' has fewer columns than specified in the column list.",
                },
                {
                    code: "MissingColumn",
                    message: "No column was specified for column 1 of 'c_missing'.",
                },
                {
                    code: "MoreColumns",
                    message: "'derived' has more columns than specified in the column list.",
                },
                {
                    code: "MissingColumn",
                    message: "No column was specified for column 1 of 'dbo.v_missing'.",
                },
            ],
        );
    });

    // PIVOT/UNPIVOT output names cannot collide with source columns, and UNPIVOT inputs are unique.
    test("validates pivot and unpivot column identities", async () => {
        const provider = metadata({
            objects: [table("metrics", "dbo", "Metrics")],
            columns: new Map([
                [
                    "metrics",
                    ["Amount", "Category", "Q1", "Value", "Month"].map((name) => ({
                        name,
                        typeDisplay: "int",
                    })),
                ],
            ]),
        });
        const diagnostics = await analyze(
            `SELECT * FROM dbo.Metrics
PIVOT (SUM(Amount) FOR Category IN (Q1, Q2, Q2)) AS p;
SELECT * FROM dbo.Metrics
UNPIVOT (Value FOR Month IN (Q1, Q1, Q2)) AS u;`,
            provider,
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "ColumnNameConflictsInPivot",
                    message:
                        'The column name "Q1" specified in the PIVOT operator conflicts with the existing column name in the PIVOT argument.',
                },
                {
                    code: "ColumnSpecifiedMultipleTimes",
                    message: "The column 'Q2' was specified multiple times for 'p'.",
                },
                {
                    code: "ColumnNameConflictsInUnpivot",
                    message:
                        'The column name "Value" specified in the UNPIVOT operator conflicts with the existing column name in the UNPIVOT argument.',
                },
                {
                    code: "ColumnNameConflictsInUnpivot",
                    message:
                        'The column name "Month" specified in the UNPIVOT operator conflicts with the existing column name in the UNPIVOT argument.',
                },
                {
                    code: "ColumnSpecifiedMultipleTimesInUnpivot",
                    message:
                        'The column "Q1" is specified multiple times in the column list of the UNPIVOT operator.',
                },
            ],
        );
    });

    // PIVOT requires a recognized aggregate with the aggregate's required argument count.
    test("validates pivot aggregate names and arguments", async () => {
        const provider = metadata({
            objects: [table("metrics", "dbo", "Metrics")],
            columns: new Map([
                [
                    "metrics",
                    ["Amount", "Category"].map((name) => ({ name, typeDisplay: "int" })),
                ],
            ]),
        });
        const diagnostics = await analyze(
            `SELECT * FROM dbo.Metrics PIVOT (ABS(Amount) FOR Category IN (Q1)) AS p;
SELECT * FROM dbo.Metrics PIVOT (SUM() FOR Category IN (Q1)) AS p;`,
            provider,
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InvalidAggregateFunction",
                    message: "'ABS' is not a recognized aggregate function.",
                },
                {
                    code: "InsufficientArguments",
                    message:
                        "An insufficient number of arguments were supplied for the procedure or function SUM.",
                },
            ],
        );
    });

    // Authoritative routine metadata supplies required/defaulted parameter counts for scalar and
    // table-valued function calls without executing a metadata query during binding.
    test("validates catalog function arguments", async () => {
        const functionObject = {
            ref: { id: "price-function", database: "db" },
            database: "db",
            schema: "dbo",
            name: "Price",
            kind: "scalarFunction",
        };
        const provider = metadata({
            objects: [functionObject],
            parameters: new Map([
                [
                    "price-function",
                    [
                        {
                            ordinal: 1,
                            name: "@required",
                            typeDisplay: "int",
                            hasDefault: false,
                        },
                        {
                            ordinal: 2,
                            name: "@optional",
                            typeDisplay: "int",
                            hasDefault: true,
                        },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            "SELECT dbo.Price(), dbo.Price(1), dbo.Price(1, 2, 3);",
            provider,
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InsufficientArguments",
                    message:
                        "An insufficient number of arguments were supplied for the procedure or function dbo.Price.",
                },
                {
                    code: "TooManyArguments",
                    message: "Procedure or function 'dbo.Price' has too many arguments specified.",
                },
            ],
        );
    });

    // Procedure metadata drives exact named-argument and arity diagnostics without a query round trip.
    test("validates procedure arguments from the pinned metadata view", async () => {
        const procedure = {
            ref: { id: "save", database: "db" },
            database: "db",
            schema: "dbo",
            name: "SaveCustomer",
            kind: "procedure",
        };
        const provider = metadata({
            objects: [procedure],
            parameters: new Map([
                [
                    "save",
                    [
                        { ordinal: 1, name: "@Id", typeDisplay: "int" },
                        { ordinal: 2, name: "@Name", typeDisplay: "nvarchar(50)", output: true },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            "EXEC dbo.SaveCustomer @Bad = 1, @Id = 2, @Id = 3, @Name = N'x' OUTPUT, 9;",
            provider,
        );
        assert.ok(messages(diagnostics).includes("@Bad is not a parameter for procedure dbo.SaveCustomer."));
        assert.ok(messages(diagnostics).includes("Parameter '@Id' was supplied multiple times."));
        assert.ok(
            messages(diagnostics).includes(
                "Must pass parameter number 5 and subsequent parameters as '@name = value'. After the form '@name = value' has been used, all subsequent parameters must be passed in the form '@name = value'.",
            ),
        );
    });

    // OUTPUT can write only into a variable; applying it to a constant is rejected independently
    // of the procedure's own output-parameter declaration.
    test("rejects constant EXECUTE OUTPUT arguments", async () => {
        const procedure = {
            ref: { id: "output-procedure", database: "db" },
            database: "db",
            schema: "dbo",
            name: "OutputProcedure",
            kind: "procedure",
        };
        const diagnostics = await analyze(
            `DECLARE @result int;
EXEC dbo.OutputProcedure @value = @result OUTPUT;
EXEC dbo.OutputProcedure @value = 1 OUTPUT;`,
            metadata({
                objects: [procedure],
                parameters: new Map([
                    [
                        "output-procedure",
                        [{ ordinal: 1, name: "@value", typeDisplay: "int", output: true }],
                    ],
                ]),
            }),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InvalidConstantOutput",
                    message:
                        "Cannot use the OUTPUT option when passing a constant to a stored procedure.",
                },
            ],
        );
    });

    // Missing-parameter diagnostics require authoritative default information. The same contract
    // works for catalog routines and procedures declared earlier in the document.
    test("reports required procedure parameters without treating defaults as required", async () => {
        const procedure = {
            ref: { id: "required-procedure", database: "db" },
            database: "db",
            schema: "dbo",
            name: "RequiredProcedure",
            kind: "procedure",
        };
        const diagnostics = await analyze(
            `EXEC dbo.RequiredProcedure @optional = 1;
GO
CREATE PROCEDURE dbo.LocalProcedure @required int, @optional int = 1 AS SELECT 1;
GO
EXEC dbo.LocalProcedure @optional = 1;`,
            metadata({
                objects: [procedure],
                parameters: new Map([
                    [
                        "required-procedure",
                        [
                            {
                                ordinal: 1,
                                name: "@required",
                                typeDisplay: "int",
                                hasDefault: false,
                            },
                            {
                                ordinal: 2,
                                name: "@optional",
                                typeDisplay: "int",
                                hasDefault: true,
                            },
                        ],
                    ],
                ]),
            }),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "MissingParameter",
                    message:
                        "Procedure or function 'dbo.RequiredProcedure' expects parameter '@required', which was not supplied.",
                },
                {
                    code: "MissingParameter",
                    message:
                        "Procedure or function 'dbo.LocalProcedure' expects parameter '@required', which was not supplied.",
                },
            ],
        );
    });

    // INSERT and UPDATE list validation uses the resolved target shape, not textual heuristics.
    test("validates DML target columns and cardinality", async () => {
        const provider = metadata({
            objects: [table("target", "dbo", "Target")],
            columns: new Map([
                [
                    "target",
                    [
                        { name: "Id", typeDisplay: "int" },
                        { name: "Name", typeDisplay: "nvarchar(50)" },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            `INSERT dbo.Target (Id, Id, Missing) VALUES (1, 2), (3);
             UPDATE dbo.Target SET Name = N'a', Name = N'b', Missing = 1;`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("The column 'Id' was specified multiple times for 'dbo.Target'."));
        assert.ok(output.includes("Column name 'Missing' does not exist in the target table or view."));
        assert.ok(output.includes("The number of columns for each row in a table value constructor must be the same."));
        assert.ok(
            output.includes(
                "The column name 'Name' is specified more than once in the SET clause. A column cannot be assigned more than one value in the same SET clause. Modify the SET clause to make sure that a column is updated only once. If the SET clause updates columns of a view, then the column name 'Name' may appear twice in the view definition.",
            ),
        );
    });

    // OUTPUT expressions reject subqueries and aggregates while ordinary inserted/deleted column
    // projections remain valid.
    test("validates OUTPUT expression restrictions", async () => {
        const provider = metadata({
            objects: [table("items", "dbo", "Items")],
            columns: new Map([["items", [{ name: "Id", typeDisplay: "int" }]]]),
        });
        const diagnostics = await analyze(
            `UPDATE dbo.Items SET Id = 1
             OUTPUT (SELECT 1), COUNT(*), inserted.Id;`,
            provider,
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) =>
                    ["SubqueriesNotAllowedInOutput", "AggregateNotAllowedInOutput"].includes(code),
                )
                .map(({ message }) => message),
            [
                "Subqueries are not allowed in the OUTPUT clause.",
                "An aggregate may not appear in the OUTPUT clause.",
            ],
        );
    });

    // OUTPUT INTO rejects views and CTEs, and table-variable identity columns cannot be named as
    // destinations. A regular table destination with an explicit nonidentity list stays valid.
    test("validates OUTPUT INTO targets and identity columns", async () => {
        const items = table("items", "dbo", "Items");
        const archive = table("archive", "dbo", "Archive");
        const destinationView = {
            ref: { id: "destination-view", database: "db" },
            database: "db",
            schema: "dbo",
            name: "DestinationView",
            kind: "view",
        };
        const provider = metadata({
            objects: [items, archive, destinationView],
            columns: new Map([
                ["items", [{ name: "Id", typeDisplay: "int" }]],
                [
                    "archive",
                    [
                        { name: "ArchiveId", typeDisplay: "int", identity: true },
                        { name: "Id", typeDisplay: "int" },
                    ],
                ],
                ["destination-view", [{ name: "Id", typeDisplay: "int" }]],
            ]),
        });
        const diagnostics = await analyze(
            `DECLARE @results TABLE(ResultId int IDENTITY, Id int);
             UPDATE dbo.Items SET Id = 1 OUTPUT inserted.Id INTO @results(ResultId);
             UPDATE dbo.Items SET Id = 2 OUTPUT inserted.Id INTO dbo.DestinationView(Id);
             WITH Destination AS (SELECT Id FROM dbo.Archive)
             UPDATE dbo.Items SET Id = 3 OUTPUT inserted.Id INTO Destination(Id);
             UPDATE dbo.Items SET Id = 4 OUTPUT inserted.Id, inserted.Id INTO dbo.Archive;
             UPDATE dbo.Items SET Id = 5 OUTPUT inserted.Id INTO dbo.Archive(Id);`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes("INSERT into an identity column not allowed on table variables."),
        );
        assert.ok(
            output.includes(
                "The target 'dbo.DestinationView' of the OUTPUT INTO clause cannot be a view or common table expression.",
            ),
        );
        assert.ok(
            output.includes(
                "The target 'Destination' of the OUTPUT INTO clause cannot be a view or common table expression.",
            ),
        );
        assert.ok(
            output.includes(
                "An explicit value for the identity column in table 'dbo.Archive' can only be specified when a column list is used and IDENTITY_INSERT is ON.",
            ),
        );
        assert.equal(
            diagnostics.filter(({ code }) => code === "ExplicitValueForIdentityColumn").length,
            1,
        );
    });

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
        assert.ok(output.some((message) => message.startsWith("Function call cannot be used to match a target table")));
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
        assert.ok(output.includes("The ORDER BY position number 3 is out of range of the number of items in the select list."));
        assert.ok(output.includes("A constant expression was encountered in the ORDER BY list, position 3."));
    });

    // Type and column-option validation preserves SQL Server precision and IDENTITY diagnostics.
    test("validates data type bounds and incompatible column options", async () => {
        const diagnostics = await analyze(
            "CREATE TABLE dbo.Bad (A decimal(2,3), B varchar(9001), C nvarchar(5000), D int IDENTITY NULL DEFAULT 1);",
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("The scale must be less than or equal to the precision."));
        assert.ok(output.includes("The size (9001) given to the type 'varchar' exceeds the maximum allowed (8000)."));
        assert.ok(output.includes("The size (5000) given to the type 'nvarchar' exceeds the maximum allowed (4000)."));
        assert.ok(output.includes("Could not create IDENTITY attribute on nullable column 'D', table 'dbo.Bad'."));
        assert.ok(output.includes("Defaults cannot be created on columns with an IDENTITY attribute. Table 'dbo.Bad', column 'D'."));
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
        assert.equal(codes.filter((code) => code === "TableValuedParameterMustBeReadOnly").length, 2);
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
        assert.ok(output.includes("Multiple NULL constraints were specified for column 'A', table 'dbo.Constraints'."));
        assert.ok(output.includes("Both a PRIMARY KEY and UNIQUE constraint have been defined for column 'B', table 'dbo.Constraints'. Only one is allowed."));
        assert.ok(output.includes("Cannot add multiple PRIMARY KEY constraints to table 'dbo.Constraints'."));
        assert.ok(output.some((message) => message.startsWith("Cannot create the sparse column 'D'")));
        assert.ok(output.some((message) => message.startsWith("A DEFAULT constraint cannot be created on the column 'E'")));
        assert.ok(output.some((message) => message.startsWith("Column 'F' in table 'dbo.Constraints' is of a type that is invalid for use as a key column")));
        assert.ok(output.some((message) => message.startsWith("Cannot create the sparse column set 'S2'")));
        assert.ok(output.some((message) => message.startsWith("Temporal generated always column 'Started'")));
        assert.ok(output.includes("Table cannot have more than one 'GENERATED ALWAYS AS ROW START' column."));
        assert.ok(output.some((message) => message.startsWith("Table SYSTEM_TIME period definition start column name")));
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
            output.includes(
                "Foreign key 'FK_View' references invalid table 'dbo.ParentView'.",
            ),
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

    // Index validation uses loaded column shapes and validates structural option ranges locally.
    test("validates index columns, types, and options", async () => {
        const provider = metadata({
            objects: [table("indexed", "dbo", "Indexed")],
            columns: new Map([
                [
                    "indexed",
                    [
                        { name: "Id", typeDisplay: "int" },
                        { name: "Payload", typeDisplay: "xml" },
                        { name: "Legacy", typeDisplay: "text" },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            `CREATE CLUSTERED INDEX ix_bad ON dbo.Indexed
                (Payload, Payload, Missing)
                INCLUDE (Legacy)
                WHERE 1
                WITH (FILLFACTOR = 101, MAXDOP = 65);`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("Cannot use duplicate column names in index. Column name 'Payload' listed more than once."));
        assert.ok(output.includes("Column name 'Missing' does not exist in the target table or view."));
        assert.ok(output.includes("Column 'Payload' in table 'dbo.Indexed' is of a type that is invalid for use as a key column in an index."));
        assert.ok(output.includes(" Column 'Legacy' in table 'dbo.Indexed' is of a type that is invalid for use as included column in an index."));
        assert.ok(output.includes("Cannot specify included columns for a clustered index."));
        assert.ok(output.includes("Fillfactor 101 is not a valid percentage; fillfactor must be between 1 and 100."));
        assert.ok(output.some((message) => message.startsWith("'65' is out of range for index option 'maxdop'")));
        assert.ok(output.includes("Incorrect WHERE clause for filtered index 'ix_bad' on table 'dbo.Indexed'."));
    });

    // A semantic index cannot infer its embedding model from unrelated physical options.
    test("requires a semantic index external model", async () => {
        const diagnostics = await analyze(
            "CREATE SEMANTIC INDEX ix ON dbo.Documents (Body) WITH (MAXDOP = 4);",
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "MissingSemanticIndexOption")
                .map(({ message }) => message),
            ["Missing EXTERNAL_MODEL in the CREATE SEMANTIC INDEX statement."],
        );
    });

    // Temporal table validation covers missing, duplicate, nullable, and mismatched period columns.
    test("validates temporal period contracts", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE dbo.NoStart (Ended datetime2 GENERATED ALWAYS AS ROW END, PERIOD FOR SYSTEM_TIME (Ended, Ended));
GO
CREATE TABLE dbo.NoEnd (Started datetime2 GENERATED ALWAYS AS ROW START, PERIOD FOR SYSTEM_TIME (Started, Started));
GO
CREATE TABLE dbo.NoPeriod (Started datetime2 GENERATED ALWAYS AS ROW START);
GO
CREATE TABLE dbo.Duplicates (
    Started datetime2 GENERATED ALWAYS AS ROW START NULL,
    Ended datetime2 GENERATED ALWAYS AS ROW END,
    EndedAgain datetime2 GENERATED ALWAYS AS ROW END,
    PERIOD FOR SYSTEM_TIME (Started, WrongEnd),
    PERIOD FOR SYSTEM_TIME (Started, Ended)
);`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("Temporal 'GENERATED ALWAYS AS ROW START' column definition missing."));
        assert.ok(output.includes("Temporal 'GENERATED ALWAYS AS ROW END' column definition missing."));
        assert.ok(output.includes("Cannot create generated always column when SYSTEM_TIME period is not defined."));
        assert.ok(output.includes("Period column 'Started' in a system-versioned temporal table cannot be nullable."));
        assert.ok(output.includes("Table cannot have more than one 'GENERATED ALWAYS AS ROW END' column."));
        assert.ok(output.includes("Table cannot have more than one SYSTEM_TIME period definition."));
        assert.ok(output.some((message) => message.startsWith("Table SYSTEM_TIME period definition end column name")));
    });

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
        assert.ok(output.includes("There is already an object named 'dbo.Existing' in the database."));
        assert.ok(output.includes(' The specified schema name "missing" either does not exist or you do not have permission to use it.'));
        assert.ok(output.includes("Cannot perform alter on 'dbo.Unknown' because it is an incompatible object type."));
        assert.ok(output.includes("Cannot drop the table 'dbo.Unknown', because it does not exist or you do not have permission."));
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
        assert.equal(output.some((message) => message.includes("Database 'db' does not exist")), false);
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
                    message: "RETURN statements in scalar valued functions must include an argument.",
                },
                {
                    code: "LastStatementWithinFunctionMustBeReturn",
                    message: "The last statement included within a function must be a return statement.",
                },
                {
                    code: "UseReturnStatementWithValueCannotBeUsed",
                    message: " A RETURN statement with a return value cannot be used in this context.",
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

    // BEGIN/END is control flow, not a new variable scope; document-local procedures persist over GO.
    test("binds batch variables through blocks and local procedures across batches", async () => {
        const diagnostics = await analyze(
            `DECLARE @i int = 0;
WHILE @i < 2
BEGIN
    SET @i = @i + 1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.LocalProcedure AS SELECT 1;
GO
EXEC dbo.LocalProcedure;`,
            metadata(),
        );
        assert.deepEqual(diagnostics, []);
    });

    // Correlated scopes and XML rowset methods bind from syntax and local table shapes.
    test("binds correlated derived tables and XML nodes rowsets", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE dbo.EmployeeData (ID int, Department nvarchar(20));
GO
SELECT (
    SELECT emp.ID
    FROM dbo.EmployeeData AS emp
    WHERE emp.Department = dept.Department
)
FROM (SELECT DISTINCT Department FROM dbo.EmployeeData) AS dept;

CREATE TABLE #XmlInput (XmlData xml);
SELECT Spec.value('.', 'int')
FROM #XmlInput
CROSS APPLY XmlData.nodes('/') AS T(Spec);`,
            metadata(),
        );
        assert.deepEqual(diagnostics, []);
    });

    // Runtime temp objects can exist outside the editor document and are not catalog-authoritative.
    test("does not claim externally created temp objects are missing", async () => {
        assert.deepEqual(await analyze("INSERT ##RuntimeLog VALUES (1);", metadata()), []);
    });

    // WHERE and JOIN predicates require a condition, while valid comparison predicates remain clean.
    test("validates boolean query contexts", async () => {
        const provider = metadata({
            objects: [table("target", "dbo", "Target")],
            columns: new Map([["target", [{ name: "Id", typeDisplay: "int" }]]]),
        });
        const diagnostics = await analyze(
            `SELECT * FROM dbo.Target WHERE 1;
SELECT * FROM dbo.Target AS a JOIN dbo.Target AS b ON 1;
SELECT * FROM dbo.Target WHERE Id = 1;`,
            provider,
        );
        assert.deepEqual(
            diagnostics.map(({ code }) => code),
            ["BooleanConditionExpected", "BooleanConditionExpected"],
        );
    });

    // Database references are diagnosed only when the pinned database list is authoritative.
    test("validates USE and multipart database references", async () => {
        const diagnostics = await analyze(
            `USE MissingDb;
SELECT * FROM MissingDb.dbo.Target;
CREATE TABLE MissingDb.dbo.NewTarget (Id int);
GO
CREATE PROCEDURE dbo.SwitchDatabase AS
BEGIN
    USE db;
END;`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes(
                "Could not locate entry in sysdatabases for database 'MissingDb'. No entry found with that name. Make sure that the name is entered correctly.",
            ),
        );
        assert.ok(
            diagnostics.some(
                ({ code, range }) =>
                    code === "CouldNotLocateEntryInSysdatabases" &&
                    range.start === "USE ".length &&
                    range.end === "USE MissingDb".length,
            ),
        );
        assert.ok(
            diagnostics.some(
                ({ code, message }) =>
                    code === "DatabaseNotExist" &&
                    message === "Database 'MissingDb' does not exist.",
            ),
        );
        assert.ok(
            output.includes(
                "a USE database statement is not allowed in a procedure, function or trigger.",
            ),
        );
    });

    // Principal DDL uses the pinned server/database principal catalog without speculative errors.
    test("validates login, user, role, and authorization identities", async () => {
        const diagnostics = await analyze(
            `CREATE LOGIN AppLogin WITH PASSWORD = 'secret';
CREATE USER Alice WITHOUT LOGIN;
CREATE ROLE app_role;
ALTER LOGIN MissingLogin DISABLE;
DROP USER MissingUser;
CREATE USER Bob FOR LOGIN MissingLogin;
CREATE SCHEMA reporting AUTHORIZATION MissingOwner;`,
            metadata({
                principals: [
                    { id: "login:app", name: "AppLogin", kind: "login" },
                    { id: "user:alice", database: "db", name: "Alice", kind: "user" },
                    {
                        id: "role:app",
                        database: "db",
                        name: "app_role",
                        kind: "databaseRole",
                    },
                ],
            }),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("There is already a login named 'AppLogin' in the database."));
        assert.ok(output.includes("There is already a user named 'Alice' in the database."));
        assert.ok(
            output.includes(
                "User, group, or role 'app_role' already exists in the current database.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot find the login 'MissingLogin', because it does not exist or you do not have permission.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot find the user 'MissingUser', because it does not exist or you do not have permission.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot find the user 'MissingOwner', because it does not exist or you do not have permission.",
            ),
        );
    });

    // A top-level CREATE LOGIN is visible to later statements, including across GO; DROP removes
    // that document-local identity, and a second CREATE is still diagnosed as a duplicate.
    test("tracks document-local login lifetime", async () => {
        const diagnostics = await analyze(
            `CREATE LOGIN LocalLogin WITH PASSWORD = 'secret';
GO
ALTER LOGIN LocalLogin DISABLE;
DROP LOGIN LocalLogin;
ALTER LOGIN LocalLogin ENABLE;
CREATE LOGIN DuplicateLogin WITH PASSWORD = 'secret';
CREATE LOGIN DuplicateLogin WITH PASSWORD = 'secret';`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => ["CouldNotFindLogin", "LoginExist"].includes(code))
                .map(({ message }) => message),
            [
                "Cannot find the login 'LocalLogin', because it does not exist or you do not have permission.",
                "There is already a login named 'DuplicateLogin' in the database.",
            ],
        );
    });

    // Cursor declaration options are accepted individually, but mutually exclusive choices in
    // each behavior group are diagnosed on the later conflicting option.
    test("validates conflicting cursor options", async () => {
        const diagnostics = await analyze(
            `DECLARE valid_cursor CURSOR LOCAL FORWARD_ONLY STATIC READ_ONLY FOR SELECT 1;
DECLARE bad_cursor CURSOR LOCAL GLOBAL FORWARD_ONLY SCROLL STATIC KEYSET READ_ONLY OPTIMISTIC FOR SELECT 1;`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options LOCAL and GLOBAL.",
                },
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options FORWARD_ONLY and SCROLL.",
                },
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options STATIC and KEYSET.",
                },
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options READ_ONLY and OPTIMISTIC.",
                },
            ],
        );
    });

    // A synonym's own name is at most schema-qualified; its referenced base object can remain a
    // valid three- or four-part name.
    test("rejects database prefixes on synonym declarations and drops", async () => {
        const sql = `CREATE SYNONYM db.dbo.BadSynonym FOR server.db.dbo.Target;
CREATE SYNONYM dbo.GoodSynonym FOR server.db.dbo.Target;
DROP SYNONYM db.dbo.BadSynonym, dbo.GoodSynonym;`;
        const diagnostics = await analyze(sql, metadata());

        assert.deepEqual(
            diagnostics.map(({ code, message, range }) => ({
                code,
                message,
                source: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "DbNameIsNotAllowedForCreateSynonym",
                    message:
                        "'CREATE SYNONYM' does not allow specifying the database name as a prefix to the object name.",
                    source: "db",
                },
                {
                    code: "DbNameIsNotAllowedForDropSynonym",
                    message:
                        "'DROP SYNONYM' does not allow specifying the database name as a prefix to the object name.",
                    source: "db",
                },
            ],
        );
    });

    // XML nodes() produces a special rowset: both the table and its node column require aliases,
    // and the node value is consumable only through XML methods or NULL predicates.
    test("validates XML nodes rowset aliases and direct node-column use", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE #XmlInput (XmlData xml);
SELECT Spec FROM #XmlInput CROSS APPLY XmlData.nodes('/') AS T(Spec);
SELECT T.* FROM #XmlInput CROSS APPLY XmlData.nodes('/') AS T(Spec);
SELECT Spec.value('.', 'int') FROM #XmlInput CROSS APPLY XmlData.nodes('/') AS T(Spec) WHERE Spec IS NOT NULL;
SELECT 1 FROM #XmlInput CROSS APPLY XmlData.nodes('/');`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InvalidColumnXmlNodeUse",
                    message:
                        "The column 'Spec' that was returned from the nodes() method cannot be used directly. It can only be used with one of the four XML data type methods, exist(), nodes(), query(), and value(), or in IS NULL and IS NOT NULL checks.",
                },
                {
                    code: "InvalidColumnXmlNodeUse",
                    message:
                        "The column 'Spec' that was returned from the nodes() method cannot be used directly. It can only be used with one of the four XML data type methods, exist(), nodes(), query(), and value(), or in IS NULL and IS NOT NULL checks.",
                },
                {
                    code: "TVFMethodMustBeAliased",
                    message:
                        "The table (and its columns) returned by a table-valued method need to be aliased.",
                },
            ],
        );
    });
});

async function analyze(sql, provider, options = {}) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open("file:///semantic-diagnostics.sql", 1, sql);
    if (!options.allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics;
}

function metadata(input = {}) {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        ...input,
    });
}

function table(id, schema, name) {
    return { ref: { id, database: "db" }, database: "db", schema, name, kind: "table" };
}

function messages(diagnostics) {
    return diagnostics.map(({ message }) => message);
}
