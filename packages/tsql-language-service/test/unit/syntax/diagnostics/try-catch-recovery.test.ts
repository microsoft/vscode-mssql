/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("try-catch-recovery.sql");

suite("TRY CATCH recovery diagnostics", () => {
    test("accepts nonempty paired blocks", () => {
        assertValid("BEGIN TRY SELECT 1 END TRY BEGIN CATCH PRINT 'failed' END CATCH");
        assertValid("BEGIN TRY GOTO failed END TRY BEGIN CATCH failed: PRINT 'failed' END CATCH");
        assert.deepEqual(
            parse("BEGIN TRY GOTO failed END TRY BEGIN CATCH\nfailed:\nEND CATCH").diagnostics,
            [],
        );
    });

    test("reports empty and incomplete pairs", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "BEGIN TRY END TRY",
                [
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'End Of File'.  Expecting BEGIN_CATCH.",
                ],
            ],
            [
                "BEGIN TRY END TRY BEGIN CATCH END CATCH",
                ["Incorrect syntax near 'TRY'.  Expecting CONVERSATION."],
            ],
            [
                "BEGIN CATCH END CATCH",
                [
                    "Incorrect syntax near 'BEGIN CATCH'.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
            ],
            ["BEGIN CATCH", ["Incorrect syntax near 'BEGIN CATCH'."]],
        ];
        for (const [sql, expected] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });

    test("reports standalone terminators", () => {
        assert.deepEqual(
            parse("END TRY").diagnostics.map(({ message }) => message),
            ["Incorrect syntax near 'TRY'.  Expecting CONVERSATION."],
        );
        assert.deepEqual(
            parse("END CATCH").diagnostics.map(({ message }) => message),
            ["Incorrect syntax near 'CATCH'.  Expecting CONVERSATION."],
        );
    });

    test("requires CATCH to immediately follow END TRY", () => {
        const sql = "BEGIN TRY SELECT 1 END TRY SELECT 1 BEGIN CATCH END CATCH";
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'SELECT'.  Expecting BEGIN_CATCH.",
                "Incorrect syntax near 'BEGIN CATCH'.",
            ],
        );
    });

    test("reports malformed nested block pairings", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "BEGIN TRY END TRY BEGIN CATCH BEGIN CATCH END TRY END CATCH",
                [
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'BEGIN CATCH'.",
                    "Incorrect syntax near 'TRY'.  Expecting CATCH.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
            ],
            [
                "BEGIN TRY BEGIN TRY END TRY END TRY BEGIN CATCH END CATCH",
                [
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'END'.  Expecting BEGIN_CATCH.",
                    "Incorrect syntax near 'TRY'.  Expecting CATCH.",
                ],
            ],
            [
                "BEGIN TRY BEGIN CATCH END CATCH END TRY BEGIN CATCH END CATCH",
                [
                    "Incorrect syntax near 'BEGIN CATCH'.",
                    "Incorrect syntax near 'CATCH'.  Expecting TRY.",
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
            ],
            [
                "BEGIN TRY BEGIN TRY END CATCH END TRY BEGIN CATCH END CATCH",
                [
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'End Of File'.",
                ],
            ],
            [
                "BEGIN TRY BEGIN CATCH END TRY END TRY BEGIN CATCH END CATCH",
                [
                    "Incorrect syntax near 'BEGIN CATCH'.",
                    "Incorrect syntax near 'END'.  Expecting BEGIN_CATCH.",
                    "Incorrect syntax near 'TRY'.  Expecting CATCH.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
            ],
            [
                "BEGIN TRY END TRY BEGIN CATCH BEGIN TRY END TRY END CATCH",
                [
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'END'.  Expecting BEGIN_CATCH.",
                    "Incorrect syntax near 'End Of File'.",
                ],
            ],
            [
                "BEGIN TRY END TRY BEGIN CATCH BEGIN CATCH END CATCH END CATCH",
                [
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'BEGIN CATCH'.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
            ],
            [
                "BEGIN TRY END TRY BEGIN CATCH BEGIN TRY END CATCH END CATCH",
                [
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'CATCH'.  Expecting TRY.",
                    "Incorrect syntax near 'End Of File'.",
                ],
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

    test("reports TRY CATCH constructs spanning client batches", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "BEGIN TRY SELECT 1 END TRY GO BEGIN CATCH END CATCH",
                [
                    "Incorrect syntax near 'GO'.  Expecting BEGIN_CATCH.",
                    "Incorrect syntax near 'BEGIN CATCH'.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
            ],
            [
                "BEGIN TRY SELECT 1 GO END TRY BEGIN CATCH END CATCH",
                [
                    "Incorrect syntax near 'GO'.",
                    "Incorrect syntax near 'TRY'.  Expecting CONVERSATION.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
            ],
            [
                "BEGIN TRY SELECT 1 END TRY BEGIN CATCH GO END CATCH",
                [
                    "Incorrect syntax near 'GO'.",
                    "Incorrect syntax near 'CATCH'.  Expecting CONVERSATION.",
                ],
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
});
