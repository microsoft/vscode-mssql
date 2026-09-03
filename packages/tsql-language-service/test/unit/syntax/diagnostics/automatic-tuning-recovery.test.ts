/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("automatic-tuning-recovery.sql");

suite("ALTER DATABASE AUTOMATIC_TUNING recovery diagnostics", () => {
    test("accepts supported database and option forms", () => {
        assertValid("ALTER DATABASE db SET AUTOMATIC_TUNING = AUTO;");
        assertValid("ALTER DATABASE db SET AUTOMATIC_TUNING = INHERIT;");
        assertValid("ALTER DATABASE db SET AUTOMATIC_TUNING (FORCE_LAST_GOOD_PLAN = ON);");
    });

    test("reports invalid generic forms", () => {
        const sql = `
ALTER DATABASE db SET AUTOMATIC_TUNING = OFF;
ALTER DATABASE db SET AUTOMATIC_TUNING;
ALTER DATABASE SET AUTOMATIC_TUNING = AUTO;`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'OFF'.  Expecting auto, custom, or inherit.",
                "Incorrect syntax near ';'.  Expecting '(', or '='.",
                "Incorrect syntax near 'SET'.",
                "Incorrect syntax near '='.",
            ],
        );
    });

    test("reports invalid FORCE_LAST_GOOD_PLAN forms", () => {
        const sql = `
ALTER DATABASE db SET AUTOMATIC_TUNING FORCE_LAST_GOOD_PLAN = ON;
ALTER DATABASE db SET AUTOMATIC_TUNING (FORCE_LAST_GOOD_PLAN);
ALTER DATABASE SET AUTOMATIC_TUNING (FORCE_LAST_GOOD_PLAN = ON);`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'FORCE_LAST_GOOD_PLAN'.  Expecting '(', or '='.",
                "Incorrect syntax near ')'.  Expecting '='.",
                "Incorrect syntax near 'SET'.",
                "Incorrect syntax near '('.",
                "Incorrect syntax near 'FORCE_LAST_GOOD_PLAN'.  Expecting '(', or SELECT.",
            ],
        );
    });
});
