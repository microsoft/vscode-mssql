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

suite("T-SQL query binding diagnostics", () => {
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
            messages(diagnostics).includes(
                "Column names in each table must be unique. Column name 'Id' in table 'dbo.Bad' is specified more than once.",
            ),
        );
    });
    // A recovered column declaration still owns enough structure for the binder to provide the
    // specific missing-type diagnostic in addition to the parser's local recovery diagnostic.
    test("reports a missing column data type from a recovered table definition", async () => {
        const diagnostics = await analyze("CREATE TABLE dbo.Bad (MissingType);", metadata(), {
            allowSyntaxDiagnostics: true,
        });

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "DataTypeMissing")
                .map(({ message }) => message),
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
        assert.ok(
            output.includes(
                "Recursive common table expression 'no_union' does not contain a top-level UNION ALL operator.",
            ),
        );
        assert.ok(
            output.includes('No anchor member was specified for recursive query "no_anchor".'),
        );
        assert.ok(
            output.includes(
                "Recursive member of a common table expression 'multiple_refs' has multiple recursive references.",
            ),
        );
        assert.ok(
            output.includes(
                'An anchor member was found in the recursive part of recursive query "late_anchor".',
            ),
        );
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
                .filter(({ code }) =>
                    ["MoreColumns", "FewerColumns", "MissingColumn"].includes(code),
                )
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
                ["metrics", ["Amount", "Category"].map((name) => ({ name, typeDisplay: "int" }))],
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
});
