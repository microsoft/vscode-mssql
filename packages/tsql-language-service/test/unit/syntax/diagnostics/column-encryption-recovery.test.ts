/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("column-encryption-recovery.sql");
const options =
    "COLUMN_ENCRYPTION_KEY = cek1, ENCRYPTION_TYPE = RANDOMIZED, ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'";

suite("encrypted-column recovery diagnostics", () => {
    test("accepts a valid encrypted column", () => {
        assertValid(`CREATE TABLE t (c int ENCRYPTED WITH (${options}));`);
    });

    test("validates encryption option value kinds", () => {
        const cases: readonly [string, string][] = [
            [
                "COLUMN_ENCRYPTION_KEY = 'cek1', ENCRYPTION_TYPE = RANDOMIZED, ALGORITHM = 'a'",
                "Incorrect syntax near ''cek1''.  Expecting ID, or QUOTED_ID.",
            ],
            [
                "COLUMN_ENCRYPTION_KEY = cek1, ENCRYPTION_TYPE = 'RANDOMIZED', ALGORITHM = 'a'",
                "Incorrect syntax near ''RANDOMIZED''.  Expecting ID.",
            ],
            [
                "COLUMN_ENCRYPTION_KEY = cek1, ENCRYPTION_TYPE = RANDOMIZED, ALGORITHM = AEAD_AES_256_CBC_HMAC_SHA_256",
                "Incorrect syntax near 'AEAD_AES_256_CBC_HMAC_SHA_256'.  Expecting STRING, or TEXT_LEX.",
            ],
        ];
        for (const [clause, expected] of cases) {
            const sql = `CREATE TABLE t (c int ENCRYPTED WITH (${clause}));`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [expected],
                sql,
            );
        }
    });

    test("reports missing separators and malformed option names", () => {
        const cases: readonly [string, string][] = [
            [
                "COLUMN_ENCRYPTION_KEY = cek1, ENCRYPTION_TYPE = RANDOMIZED ALGORITHM = 'a'",
                "Incorrect syntax near 'ALGORITHM'.  Expecting ')', or ','.",
            ],
            [
                "COLUMN_ENCRYPTION_KEY = cek1, ENCRYPTION TYPE = RANDOMIZED, ALGORITHM = 'a'",
                "Incorrect syntax near 'ENCRYPTION'.  Expecting CEMK_ALGORITHM, CEMK_COL_ENCRYPTION_KEY, or CEMK_ENCRYPTION_TYPE.",
            ],
        ];
        for (const [clause, expected] of cases) {
            const sql = `CREATE TABLE t (c int ENCRYPTED WITH (${clause}));`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [expected],
                sql,
            );
        }
    });

    test("reports malformed ENCRYPTED WITH introductions", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                `ENCRYPTED WITH ${options}`,
                ["Incorrect syntax near 'COLUMN_ENCRYPTION_KEY'.  Expecting '('."],
            ],
            [
                `ENCRYPTED (${options})`,
                [
                    "Incorrect syntax near '('.  Expecting WITH.",
                    "Incorrect syntax near 'COLUMN_ENCRYPTION_KEY'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                `ENCRYPTED WIT (${options})`,
                [
                    "Incorrect syntax near 'WIT'.  Expecting WITH.",
                    "Incorrect syntax near 'COLUMN_ENCRYPTION_KEY'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                `NCRYPTED WITH (${options})`,
                [
                    "Incorrect syntax near 'NCRYPTED'.",
                    "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    "Incorrect syntax near 'COLUMN_ENCRYPTION_KEY'.  Expecting '(', or SELECT.",
                ],
            ],
        ];
        for (const [columnClause, expected] of cases) {
            const sql = `CREATE TABLE t (c int ${columnClause});`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });

    test("reports a missing comma between encrypted columns without cascading", () => {
        const sql = `CREATE TABLE t (
 c1 int ENCRYPTED WITH (${options})
 c2 bigint ENCRYPTED WITH (${options})
);`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'c2'.",
                "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                "Incorrect syntax near 'COLUMN_ENCRYPTION_KEY'.  Expecting '(', or SELECT.",
            ],
        );
    });
});
