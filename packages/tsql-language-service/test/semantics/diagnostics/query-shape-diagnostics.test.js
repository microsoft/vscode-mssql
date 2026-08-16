/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// UNION is the only set operator with an ALL form. The other operators parse ALL so the
// unsupported combination can be named instead of recovered.
const { createSemanticHarness } = require("../../support/semanticHarness.js");
const { analyze } = createSemanticHarness({ uri: "file:///query-shape.sql" });

suite("T-SQL set operator validation", () => {
    // The report names the operator and covers the operator and its ALL keyword.
    test("rejects EXCEPT ALL with exact output", async () => {
        const sql = "SELECT 1 EXCEPT ALL SELECT 2;";
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
                    code: "OperatorNotSupported",
                    message: "The 'ALL' version of the Except operator is not supported.",
                    severity: "error",
                    text: "EXCEPT ALL",
                },
            ],
        );
    });

    // INTERSECT binds more tightly than EXCEPT but carries the same rule.
    test("rejects INTERSECT ALL", async () => {
        assert.deepEqual(
            (await analyze("SELECT 1 INTERSECT ALL SELECT 2;")).map(({ code, message }) => [
                code,
                message,
            ]),
            [
                [
                    "OperatorNotSupported",
                    "The 'ALL' version of the Intersect operator is not supported.",
                ],
            ],
        );
    });

    // Every supported set-operator spelling stays silent.
    test("accepts supported set operators", async () => {
        for (const sql of [
            "SELECT 1 UNION SELECT 2;",
            "SELECT 1 UNION ALL SELECT 2;",
            "SELECT 1 EXCEPT SELECT 2;",
            "SELECT 1 INTERSECT SELECT 2;",
            "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3;",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Each unsupported operator in a chain is reported once.
    test("reports every unsupported operator in a chain", async () => {
        assert.deepEqual(
            (await analyze("SELECT 1 EXCEPT ALL SELECT 2 EXCEPT ALL SELECT 3;")).map(
                ({ code }) => code,
            ),
            ["OperatorNotSupported", "OperatorNotSupported"],
        );
    });
});

// GROUP BY carries a legacy trailing option word; only CUBE and ROLLUP are recognized.
suite("T-SQL GROUP BY option validation", () => {
    // The report covers the option phrase and repeats the spelling as written.
    test("rejects an unrecognized GROUP BY option with exact output", async () => {
        const sql = `CREATE TABLE dbo.t (c1 int, c2 int);
SELECT c1 FROM dbo.t GROUP BY c1 WITH BANANA;`;
        const diagnostics = (await analyze(sql)).filter(
            ({ code }) => code === "InvalidGroupByOption",
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
                    code: "InvalidGroupByOption",
                    message: " 'WITH BANANA' is not a recognized GROUP BY option.",
                    severity: "error",
                    text: "WITH BANANA",
                },
            ],
        );
    });

    // Both recognized options, in any casing, and the distribution hint stay silent.
    test("accepts recognized GROUP BY tails", async () => {
        for (const tail of [
            "GROUP BY c1 WITH CUBE",
            "GROUP BY c1 WITH ROLLUP",
            "GROUP BY c1 with rollup",
            "GROUP BY c1, c2 WITH CUBE",
            "GROUP BY c1 WITH (DISTRIBUTED_AGG), c2",
            "GROUP BY c1, c2",
        ]) {
            const sql = `CREATE TABLE dbo.t (c1 int, c2 int);
SELECT c1 FROM dbo.t ${tail};`;
            assert.deepEqual(await analyze(sql), [], tail);
        }
    });

    // The option spelling is normalized to single spaces, as SQL Server composes it.
    test("normalizes whitespace inside the reported option", async () => {
        const sql = `CREATE TABLE dbo.t (c1 int);
SELECT c1 FROM dbo.t GROUP BY c1 WITH
   BANANA;`;

        assert.deepEqual(
            (await analyze(sql))
                .filter(({ code }) => code === "InvalidGroupByOption")
                .map(({ message }) => message),
            [" 'WITH BANANA' is not a recognized GROUP BY option."],
        );
    });
});
