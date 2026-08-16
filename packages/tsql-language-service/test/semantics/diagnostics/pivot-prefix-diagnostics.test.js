/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const source = `CREATE TABLE dbo.Sales (Id int, Region nvarchar(10), Amount int, Y2023 int, Y2024 int);
`;

// A PIVOT column list names new output columns, and an UNPIVOT value or pivoted column names a new
// output column, so neither may carry a qualifier.
const { createSemanticHarness } = require("../../support/semanticHarness.js");
const { analyze } = createSemanticHarness({ uri: "file:///pivot-prefix.sql" });

suite("T-SQL pivot column prefix validation", () => {
    // The report covers the whole qualified name.
    test("rejects a prefixed PIVOT column with exact output", async () => {
        const sql = `${source}SELECT * FROM (SELECT Region, Amount FROM dbo.Sales) AS s
PIVOT (SUM(Amount) FOR Region IN (s.East, West)) AS p;`;
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "PrefixedColumnsNotAllowedInPivot",
                    message:
                        "Prefixed columns are not allowed in the column list of a PIVOT operator.",
                    severity: "error",
                    text: "s.East",
                },
            ],
        );
    });

    // Both UNPIVOT output columns carry the rule, with their own message.
    test("rejects prefixed UNPIVOT value and pivoted columns", async () => {
        const sql = `${source}SELECT * FROM dbo.Sales
UNPIVOT (u.Total FOR u.Year IN (Y2023, Y2024)) AS u;`;
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, range }) => [
                code,
                message,
                sql.slice(range.start, range.end),
            ]),
            [
                [
                    "PrefixedColumnsNotAllowedInUnpivot",
                    "Prefixes are not allowed in value or pivot columns of an UNPIVOT operator.",
                    "u.Total",
                ],
                [
                    "PrefixedColumnsNotAllowedInUnpivot",
                    "Prefixes are not allowed in value or pivot columns of an UNPIVOT operator.",
                    "u.Year",
                ],
            ],
        );
    });

    // A qualified name replaces the conflict and duplicate reports for that column.
    test("reports the prefix instead of a conflict for the same column", async () => {
        const sql = `${source}SELECT * FROM (SELECT Region, Amount FROM dbo.Sales) AS s
PIVOT (SUM(Amount) FOR Region IN (s.Region, s.Region)) AS p;`;

        assert.deepEqual(
            (await analyze(sql)).map(({ code }) => code),
            ["PrefixedColumnsNotAllowedInPivot", "PrefixedColumnsNotAllowedInPivot"],
        );
    });

    // Unqualified names keep their existing conflict and duplicate behavior.
    test("keeps unqualified pivot validation intact", async () => {
        const conflict = `${source}SELECT * FROM (SELECT Region, Amount FROM dbo.Sales) AS s
PIVOT (SUM(Amount) FOR Region IN (Region)) AS p;`;
        assert.deepEqual(
            (await analyze(conflict)).map(({ code }) => code),
            ["ColumnNameConflictsInPivot"],
        );

        const duplicate = `${source}SELECT * FROM (SELECT Region, Amount FROM dbo.Sales) AS s
PIVOT (SUM(Amount) FOR Region IN (East, East)) AS p;`;
        assert.deepEqual(
            (await analyze(duplicate)).map(({ code }) => code),
            ["ColumnSpecifiedMultipleTimes"],
        );
    });

    // Valid PIVOT and UNPIVOT queries stay silent, including delimited names.
    test("accepts unqualified pivot and unpivot columns", async () => {
        for (const sql of [
            `${source}SELECT * FROM (SELECT Region, Amount FROM dbo.Sales) AS s
PIVOT (SUM(Amount) FOR Region IN (East, West)) AS p;`,
            `${source}SELECT * FROM (SELECT Region, Amount FROM dbo.Sales) AS s
PIVOT (SUM(Amount) FOR Region IN ([East side], "West side")) AS p;`,
            `${source}SELECT * FROM dbo.Sales
UNPIVOT (Total FOR Year IN (Y2023, Y2024)) AS u;`,
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });
});
