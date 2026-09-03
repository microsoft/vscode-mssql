/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("boolean-database-options-recovery.sql");

suite("boolean ALTER DATABASE option recovery diagnostics", () => {
    test("accepts supported assignments", () => {
        assertValid("ALTER DATABASE db SET AUTOMATIC_INDEX_COMPACTION = ON;");
        assertValid("ALTER DATABASE db SET OPTIMIZED_LOCKING = OFF;");
        assertValid(`ALTER DATABASE db SET ACCELERATED_DATABASE_RECOVERY = ON
(PERSISTENT_VERSION_STORE_FILEGROUP = versions);`);
    });

    test("requires an equals sign before boolean states", () => {
        const sql = `ALTER DATABASE db SET AUTOMATIC_INDEX_COMPACTION ON;
ALTER DATABASE db SET AUTOMATIC_INDEX_COMPACTION OFF;
ALTER DATABASE db SET OPTIMIZED_LOCKING ON;
ALTER DATABASE db SET ACCELERATED_DATABASE_RECOVERY ON;
ALTER DATABASE db SET ACCELERATED_DATABASE_RECOVERY OFF;`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'ON'.  Expecting '='.",
                "Incorrect syntax near 'OFF'.  Expecting '='.",
                "Incorrect syntax near 'ON'.  Expecting '='.",
                "Incorrect syntax near 'ON'.  Expecting '='.",
                "Incorrect syntax near 'OFF'.  Expecting '='.",
            ],
        );
    });

    test("reports incomplete recovery and malformed nested options", () => {
        const sql = `ALTER DATABASE db SET ACCELERATED_DATABASE_RECOVERY;
ALTER DATABASE db SET ACCELERATED_DATABASE_RECOVERY ON
(PERSISTENT_VERSION_STORE_FILEGROUP = versions);
ALTER DATABASE db SET ACCELERATED_DATABASE_RECOVERY = ON
PERSISTENT_VERSION_STORE_FILEGROUP = versions;`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near ';'.  Expecting '='.",
                "Incorrect syntax near 'ON'.  Expecting '='.",
                "Incorrect syntax near 'PERSISTENT_VERSION_STORE_FILEGROUP'.  Expecting '(', or SELECT.",
                "Incorrect syntax near 'PERSISTENT_VERSION_STORE_FILEGROUP'.",
            ],
        );
    });
});
