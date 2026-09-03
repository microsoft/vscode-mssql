/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("sensitivity-classification-recovery.sql");
const options = "LABEL='private', INFORMATION_TYPE='financial', RANK=HIGH";

suite("sensitivity classification recovery diagnostics", () => {
    test("accepts supported ADD and DROP forms", () => {
        assertValid(`ADD SENSITIVITY CLASSIFICATION TO dbo.t.c WITH (${options});`);
        assertValid("DROP SENSITIVITY CLASSIFICATION FROM dbo.t.c, t.c2;");
    });

    test("reports malformed ADD introductions", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                `ADD SENSITIVITY TO t.c WITH (${options})`,
                [
                    "Incorrect syntax near 'TO'.  Expecting ADD_CLASSIFICATION.",
                    "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    "Incorrect syntax near 'LABEL'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                `ADD SENSITIVITY CLASSIFICATION t.c WITH (${options})`,
                [
                    "Incorrect syntax near 't'.  Expecting TO.",
                    "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    "Incorrect syntax near 'LABEL'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                `ADD SENSITIVITY CLASSIFICATION TO t.c (${options})`,
                [
                    "Incorrect syntax near '('.  Expecting ',', or WITH.",
                    "Incorrect syntax near 'LABEL'.  Expecting '(', or SELECT.",
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

    test("reports a missing classification option value", () => {
        const sql = "ADD SENSITIVITY CLASSIFICATION TO t.c WITH (LABEL='private', RANK=)";
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            ["Incorrect syntax near ')'.  Expecting ID, or STRING."],
        );
    });

    test("reports malformed DROP forms", () => {
        const cases: readonly [string, string][] = [
            [
                "DROP SENSITIVITY CLASSIFICATION FROM",
                "Incorrect syntax near 'End Of File'.  Expecting '.', ID, or QUOTED_ID.",
            ],
            [
                "DROP SENSITIVITY CLASSIFICATION FROM t.*",
                "Incorrect syntax near '*'.  Expecting '.', ID, or QUOTED_ID.",
            ],
            [
                "DROP SENSITIVITY FROM dbo.t.c",
                "Incorrect syntax near 'FROM'.  Expecting CLASSIFICATION.",
            ],
            [
                "DROP SENSITIVITY CLASSIFICATION dbo.t.c",
                "Incorrect syntax near 'dbo'.  Expecting FROM.",
            ],
        ];
        for (const [sql, expected] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [expected],
                sql,
            );
        }
    });

    test("reports a missing SENSITIVITY keyword without cascading", () => {
        assert.deepEqual(
            parse(`ADD CLASSIFICATION TO t.c WITH (${options})`).diagnostics.map(
                ({ message }) => message,
            ),
            [
                "Incorrect syntax near 'CLASSIFICATION'.  Expecting ADD_COUNTER, ADD_SENSITIVITY, or ADD_SIGNATURE.",
                "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                "Incorrect syntax near 'LABEL'.  Expecting '(', or SELECT.",
            ],
        );
        assert.deepEqual(
            parse("DROP CLASSIFICATION FROM dbo.t.c, t.c2").diagnostics.map(
                ({ message }) => message,
            ),
            ["Incorrect syntax near 'CLASSIFICATION'."],
        );
    });
});
