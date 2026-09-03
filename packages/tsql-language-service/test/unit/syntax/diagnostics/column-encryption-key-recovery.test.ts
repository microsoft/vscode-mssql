/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("column-encryption-key-recovery.sql");
const value = "(ALGORITHM = 'rsa_oeap', ENCRYPTED_VALUE = 0xdeadbeef, COLUMN_MASTER_KEY = myCMK)";

suite("column encryption key recovery diagnostics", () => {
    test("accepts underscore and legacy multiword key options", () => {
        assertValid(`CREATE COLUMN ENCRYPTION KEY key1 WITH VALUES ${value};`);
        assertValid(`CREATE COLUMN ENCRYPTION KEY key1 WITH VALUES
(ALGORITHM = 'rsa_oeap', ENCRYPTED_VALUE = 0xdeadbeef, COLUMN MASTER KEY DEFINITION = myCMK);`);
    });

    test("reports malformed VALUES and separators", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                `CREATE COLUMN ENCRYPTION KEY key1 WITH VALUES ${value} ${value}`,
                ["Incorrect syntax near 'ALGORITHM'.  Expecting '(', or SELECT."],
            ],
            [
                `CREATE COLUMN ENCRYPTION KEY key1 WITH VALUES ${value}, ${value},`,
                ["Incorrect syntax near ','."],
            ],
            [
                "CREATE COLUMN ENCRYPTION KEY key1 WITH VALUES ALGORITHM = 'rsa_oeap'",
                ["Incorrect syntax near 'ALGORITHM'.  Expecting '('."],
            ],
            [
                "CREATE COLUMN ENCRYPTION KEY key1 WITH VALUE (ALGORITHM = 'rsa_oeap')",
                [
                    "Incorrect syntax near 'VALUE'.  Expecting VALUES.",
                    "Incorrect syntax near 'ALGORITHM'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "CREATE COLUMN ENCRYPTION KEY key1 WITH VALUES (ALGORITHM = 'rsa_oeap' ENCRYPTED_VALUE = 0x01, COLUMN_MASTER_KEY = myCMK)",
                ["Incorrect syntax near 'ENCRYPTED_VALUE'.  Expecting ')', or ','."],
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

    test("validates option value kinds", () => {
        const cases: readonly [string, string][] = [
            [
                "ALGORITHM = rsa_oeap, ENCRYPTED_VALUE = 0x01, COLUMN_MASTER_KEY = myCMK",
                "Incorrect syntax near 'rsa_oeap'.  Expecting STRING, or TEXT_LEX.",
            ],
            [
                "ALGORITHM = 'rsa_oeap', ENCRYPTED_VALUE = 0x01, COLUMN_MASTER_KEY = 'myCMK'",
                "Incorrect syntax near ''myCMK''.  Expecting ID, or QUOTED_ID.",
            ],
            [
                "ALGORITHM = 'rsa_oeap', ENCRYPTED_VALUE = 'not binary', COLUMN_MASTER_KEY = myCMK",
                "Incorrect syntax near ''not binary''.  Expecting BINARY.",
            ],
        ];
        for (const [options, expected] of cases) {
            const sql = `CREATE COLUMN ENCRYPTION KEY key1 WITH VALUES (${options});`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [expected],
                sql,
            );
        }
    });
});
