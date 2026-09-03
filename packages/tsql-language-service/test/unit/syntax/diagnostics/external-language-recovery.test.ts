/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("external-language-recovery.sql");

suite("external language recovery diagnostics", () => {
    test("accepts supported lifecycle forms", () => {
        assertValid(`CREATE EXTERNAL LANGUAGE runtime FROM
(CONTENT = 0x01, FILE_NAME = N'runtime.dll', PLATFORM = WINDOWS);`);
        assertValid(`ALTER EXTERNAL LANGUAGE runtime ADD
(CONTENT = 0x02, FILE_NAME = N'runtime.so', PLATFORM = LINUX);`);
        assertValid("DROP EXTERNAL LANGUAGE runtime;");
    });

    test("validates descriptor option names and values", () => {
        assert.deepEqual(
            parse(`CREATE EXTERNAL LANGUAGE runtime FROM
(CONTENT = 0x01, FILE = N'runtime.dll')`).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'FILE'.  Expecting CONTENT, ENVIRONMENT_VARIABLES, FILE_NAME, PARAMETERS, or PLATFORM.",
            ],
        );
        assert.deepEqual(
            parse(`CREATE EXTERNAL LANGUAGE runtime FROM
(CONTENT = 0x01, FILE_NAME = N'runtime.dll', PLATFORM = N'Linux')`).diagnostics.map(
                ({ message }) => message,
            ),
            ["Incorrect syntax near 'N'Linux''.  Expecting ID."],
        );
    });

    test("reports malformed lifecycle clauses without cascading", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "CREATE EXTERNAL LANGUAGE runtime WITH (CONTENT = 0x01, FILE_NAME = N'runtime.dll')",
                [
                    "Incorrect syntax near 'WITH'.  Expecting AUTHORIZATION, or FROM.",
                    "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    "Incorrect syntax near 'CONTENT'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "ALTER EXTERNAL LANGUAGE runtime FROM (CONTENT = 0x01, FILE_NAME = N'runtime.dll')",
                [
                    "Incorrect syntax near 'FROM'.  Expecting ADD, ALTELOPT_REMOVE, AUTHORIZATION, or SET.",
                    "Incorrect syntax near 'CONTENT'.  Expecting '(', or SELECT.",
                ],
            ],
            ["DROP EXTERNAL LANGUAGE runtime REMOVE LINUX", ["Incorrect syntax near 'REMOVE'."]],
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
