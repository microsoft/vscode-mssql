/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { parse } = createSyntaxHarness("external-stream-recovery.sql");
const prefix = "CREATE EXTERNAL STREAM s WITH (";

suite("CREATE EXTERNAL STREAM recovery diagnostics", () => {
    test("reports empty and unassigned option lists", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "",
                [
                    "Incorrect syntax near ')'.  Expecting DATA_SOURCE, FILE_FORMAT, INPUT_OPTIONS, LOCATION, or OUTPUT_OPTIONS.",
                ],
            ],
            [
                "DATA_SOURCE, LOCATION, FILE_FORMAT, INPUT_OPTIONS, OUTPUT_OPTIONS,",
                ["Incorrect syntax near ','.  Expecting '='."],
            ],
        ];
        for (const [options, expected] of cases) {
            assert.deepEqual(
                parse(`${prefix}${options});`).diagnostics.map(({ message }) => message),
                expected,
                options,
            );
        }
    });

    test("reports missing separators without parser cascades", () => {
        for (const suffix of ["", ",", " =", " = value,"]) {
            const sql = `${prefix}
LOCATION='topic', FILE_FORMAT=f, INPUT_OPTIONS=N'i', OUTPUT_OPTIONS=N'o'
DATA_SOURCE${suffix});`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                ["Incorrect syntax near 'DATA_SOURCE'.  Expecting ')', or ','."],
                sql,
            );
        }
    });

    test("reports missing and chained assignment operators", () => {
        const missing = `${prefix}DATA_SOURCE LOCATION='topic', FILE_FORMAT=f);`;
        assert.deepEqual(
            parse(missing).diagnostics.map(({ message }) => message),
            ["Incorrect syntax near 'LOCATION'.  Expecting '='."],
        );

        for (const options of [
            "DATA_SOURCE = LOCATION = 'topic', FILE_FORMAT=f",
            "DATA_SOURCE = LOCATION = FILE_FORMAT = INPUT_OPTIONS = OUTPUT_OPTIONS =",
        ]) {
            assert.deepEqual(
                parse(`${prefix}${options});`).diagnostics.map(({ message }) => message),
                ["Incorrect syntax near '='.  Expecting ')', or ','."],
                options,
            );
        }
    });
});
