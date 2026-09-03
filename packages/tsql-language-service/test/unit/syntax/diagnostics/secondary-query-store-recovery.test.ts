/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("secondary-query-store-recovery.sql");

suite("secondary Query Store recovery diagnostics", () => {
    test("accepts supported secondary-replica options", () => {
        assertValid("ALTER DATABASE CURRENT FOR SECONDARY SET QUERY_STORE = OFF;");
        assertValid(`ALTER DATABASE CURRENT FOR SECONDARY SET QUERY_STORE = ON
(OPERATION_MODE = READ_WRITE, QUERY_CAPTURE_MODE = AUTO, MAX_PLANS_PER_QUERY = 10);`);
    });

    test("reports options unavailable on a secondary replica", () => {
        const options = [
            "CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = 5)",
            "SIZE_BASED_CLEANUP_MODE = AUTO",
            "MAX_STORAGE_SIZE_MB = 1024",
            "FLUSH_INTERVAL_SECONDS = 300",
            "DATA_FLUSH_INTERVAL_SECONDS = 300",
            "INTERVAL_LENGTH_MINUTES = 10",
        ];
        const sql = `ALTER DATABASE CURRENT FOR SECONDARY SET QUERY_STORE = ON
(${options.join(", ")});`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            options.map(
                (option) => `Incorrect syntax near '${option.slice(0, option.indexOf(" "))}'.`,
            ),
        );
    });

    test("reports misspelled CLEAR and SECONDARY tokens", () => {
        const sql = `ALTER DATABASE CURRENT FOR SECONDARY SET QUERY_STORE CLEER ALL;
ALTER DATABASE CURRENT FOR SECONDAARY SET QUERY_STORE = OFF;`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'CLEER'.",
                "Incorrect syntax near 'CLEER'.",
                "Incorrect syntax near 'SECONDAARY'.",
            ],
        );
    });
});
