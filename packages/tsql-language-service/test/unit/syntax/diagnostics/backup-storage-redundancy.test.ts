/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { parse } = createSyntaxHarness("backup-storage-redundancy.sql");

suite("BACKUP_STORAGE_REDUNDANCY recovery diagnostics", () => {
    test("reports unsupported ALTER DATABASE forms", () => {
        const cases: readonly [string, string][] = [
            [
                "ALTER DATABASE db MODIFY BACKUP_STORAGE_REDUNDANCY = 'GEO'",
                "Incorrect syntax near 'BACKUP_STORAGE_REDUNDANCY'.  Expecting '(', FILE, filegroup, or name.",
            ],
            [
                "ALTER DATABASE db ADD SECONDARY ON SERVER [server] WITH (BACKUP_STORAGE_REDUNDANCY='GEO')",
                "Incorrect syntax near 'BACKUP_STORAGE_REDUNDANCY'.  Expecting GEODR_CONNOPT, GEODR_REPLACE, or GEODR_SRVOBJ.",
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

    test("reports unsupported CREATE DATABASE forms", () => {
        const direct = "CREATE DATABASE db WITH BACKUP_STORAGE_REDUNDANCY = 'GEO'";
        assert.deepEqual(
            parse(direct).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'BACKUP_STORAGE_REDUNDANCY'.  Expecting CREATEDBOPT_CATALOGCOLLATION, CREATEDBOPT_FILESTREAM, CREATEDBOPT_LOGAPPLY, CREATEDBOPT_OTHER, or CREATEDBOPT_PERSISTENT_LOG_BUFFER.",
            ],
        );

        const copy =
            "CREATE DATABASE db AS COPY OF [server].[source] WITH (BACKUP_STORAGE_REDUNDANCY='GEO')";
        assert.deepEqual(
            parse(copy).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                "Incorrect syntax near 'BACKUP_STORAGE_REDUNDANCY'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("handles adjacent statements without cascading", () => {
        const sql = ["GEO", "ZONE", "LOCAL"]
            .map((value) => `ALTER DATABASE db MODIFY BACKUP_STORAGE_REDUNDANCY = '${value}'`)
            .join(" ");
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            Array.from(
                { length: 3 },
                () =>
                    "Incorrect syntax near 'BACKUP_STORAGE_REDUNDANCY'.  Expecting '(', FILE, filegroup, or name.",
            ),
        );
    });
});
