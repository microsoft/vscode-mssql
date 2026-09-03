/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness, syntaxTree } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("procedure-recovery.sql");

suite("procedure recovery diagnostics", () => {
    test("mounts bare and parenthesized procedure bodies", () => {
        assertValid("CREATE PROC p @value int AS SELECT @value;");
        const grouped = assertValid("CREATE OR ALTER PROC p (@value int) AS (SELECT @value)");
        assert.match(syntaxTree(grouped), /GroupedQueryRoot/);
    });

    test("reports malformed parameter lists without cascades", () => {
        const cases: readonly [string, readonly string[]][] = [
            ["CREATE PROC p() AS (SELECT 1)", ["Incorrect syntax near ')'.  Expecting VARIABLE."]],
            [
                "CREATE PROC p(@value) AS (SELECT 1)",
                [
                    "Incorrect syntax near ')'.  Expecting AS, CURSOR, DOUBLE, ID, NATIONAL, or QUOTED_ID.",
                ],
            ],
            [
                "CREATE PROC p(@value = 0) AS (SELECT 1)",
                [
                    "Incorrect syntax near '='.  Expecting AS, CURSOR, DOUBLE, ID, NATIONAL, or QUOTED_ID.",
                ],
            ],
            [
                "CREATE PROC p(@value int, ) AS (SELECT 1)",
                ["Incorrect syntax near ')'.  Expecting VARIABLE."],
            ],
            [
                "CREATE PROC p(value int) AS (SELECT 1)",
                ["Incorrect syntax near 'value'.  Expecting VARIABLE."],
            ],
            [
                "CREATE PROC p(@value int OUTPUT OUTPUT) AS (SELECT 1)",
                ["Incorrect syntax near 'OUTPUT'.  Expecting ')', ',', AS, FOR, or WITH."],
            ],
        ];
        for (const [sql, expected] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });

    test("reports missing option separators", () => {
        assert.deepEqual(
            parse("CREATE PROC p(@value int) WITH ENCRYPTION FOO AS (SELECT 1)").diagnostics.map(
                ({ message }) => message,
            ),
            ["Incorrect syntax near 'FOO'.  Expecting AS, or FOR."],
        );
    });

    test("reports empty parenthesized bodies", () => {
        const cases: readonly [string, string][] = [
            ["CREATE PROC p AS ()", "Incorrect syntax near ')'.  Expecting '(', or SELECT."],
            ["CREATE PROC p AS (;)", "Incorrect syntax near ';'.  Expecting '(', or SELECT."],
        ];
        for (const [sql, expected] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [expected],
                sql,
            );
        }
    });

    test("reports adjacent SELECT statements in a grouped body", () => {
        const sql = "CREATE PROC p (@a int, @b int) AS (SELECT @a SELECT @b)";
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'SELECT'.  Expecting ')', EXCEPT, or UNION.",
                "Incorrect syntax near ')'.",
            ],
        );
    });

    test("tolerates an incomplete body while it is being typed", () => {
        assert.deepEqual(parse("CREATE PROC p AS").diagnostics, []);
    });
});
