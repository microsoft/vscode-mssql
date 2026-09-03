/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("data-masking-recovery.sql");
const prefix = "ALTER TABLE t ALTER COLUMN c ";
const attributeExpectation =
    "COLADDROPOPT_HIDDEN, COLADDROPOPT_MASKED, COLADDROPOPT_PERSISTED, COLADDROPOPT_SPARSE, NOT_FOR, or ROWGUIDCOL";

suite("ALTER COLUMN data-masking recovery diagnostics", () => {
    test("accepts ADD and DROP MASKED", () => {
        assertValid(`${prefix}ADD MASKED WITH (FUNCTION = 'default()');`);
        assertValid(`${prefix}DROP MASKED;`);
    });

    test("reports every malformed masking clause without recovery cascades", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "ADD MASKED (FUNCTION = 'default()')",
                [
                    "Incorrect syntax near '('.  Expecting WITH.",
                    "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "ADD MASKD WITH (FUNCTION = 'default()')",
                [
                    `Incorrect syntax near 'MASKD'.  Expecting ${attributeExpectation}.`,
                    "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "ADD MASKED WITH FUNCTION = 'default()'",
                ["Incorrect syntax near 'FUNCTION'.  Expecting '('."],
            ],
            [
                "ADD MASKED WITH (FUNCTION 'default()')",
                ["Incorrect syntax near ''default()''.  Expecting '='."],
            ],
            [
                "ADD MASKED WITH (FUNCTION = default())",
                [
                    "Incorrect syntax near 'default'.  Expecting STRING.",
                    "Incorrect syntax near ')'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "ADD MASKED WITH ('default()')",
                ["Incorrect syntax near ''default()''.  Expecting FUNCTION."],
            ],
            [
                "ADD MASKED WTH (FUNCTION = 'default()')",
                [
                    "Incorrect syntax near 'WTH'.  Expecting WITH.",
                    "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "ADD MASKED WITH (FNCTION = 'default()')",
                ["Incorrect syntax near 'FNCTION'.  Expecting FUNCTION."],
            ],
            ["DROP MASKD", [`Incorrect syntax near 'MASKD'.  Expecting ${attributeExpectation}.`]],
        ];

        for (const [clause, expected] of cases) {
            const sql = `${prefix}${clause};`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });
});
