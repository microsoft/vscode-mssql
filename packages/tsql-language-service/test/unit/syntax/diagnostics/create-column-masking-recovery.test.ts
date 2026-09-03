/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("create-column-masking-recovery.sql");

suite("CREATE TABLE masking recovery diagnostics", () => {
    test("accepts masking in its supported column-option position", () => {
        assertValid("CREATE TABLE t (c int MASKED WITH (FUNCTION = 'default()') NOT NULL);");
    });

    test("reports malformed MASKED WITH introductions", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "MASKED (FUNCTION = 'default()')",
                [
                    "Incorrect syntax near '('.  Expecting WITH.",
                    "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "MASKD WITH (FUNCTION = 'default()')",
                [
                    "Incorrect syntax near 'MASKD'.",
                    "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "MASKED WTH (FUNCTION = 'default()')",
                [
                    "Incorrect syntax near 'WTH'.  Expecting WITH.",
                    "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "MASKED WITH FUNCTION = 'default()'",
                ["Incorrect syntax near 'FUNCTION'.  Expecting '('."],
            ],
        ];
        for (const [clause, expected] of cases) {
            const sql = `CREATE TABLE t (c int ${clause});`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });

    test("reports malformed function assignments", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "MASKED WITH (FNCTION = 'default()')",
                ["Incorrect syntax near 'FNCTION'.  Expecting FUNCTION."],
            ],
            [
                "MASKED WITH (FUNCTION 'default()')",
                ["Incorrect syntax near ''default()''.  Expecting '='."],
            ],
            [
                "MASKED WITH (FUNCTION = default())",
                [
                    "Incorrect syntax near 'default'.  Expecting STRING.",
                    "Incorrect syntax near ')'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "MASKED WITH ('default()')",
                ["Incorrect syntax near ''default()''.  Expecting FUNCTION."],
            ],
        ];
        for (const [clause, expected] of cases) {
            const sql = `CREATE TABLE t (c int ${clause});`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });

    test("rejects masking after nullability", () => {
        const sql = "CREATE TABLE t (c varchar(32) NOT NULL MASKED WITH (FUNCTION = 'email()'));";
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'MASKED'.",
                "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("reports a missing comma between masked columns without cascading", () => {
        const sql = `CREATE TABLE t (
 c1 int MASKED WITH (FUNCTION = 'default()')
 c2 varchar(32) MASKED WITH (FUNCTION = 'email()')
);`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'c2'.",
                "Incorrect syntax near '32'.  Expecting '(', or SELECT.",
                "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                "Incorrect syntax near 'FUNCTION'.  Expecting '(', or SELECT.",
            ],
        );
    });
});
