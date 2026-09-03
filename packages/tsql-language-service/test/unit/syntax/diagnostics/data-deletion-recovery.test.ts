/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("data-deletion-recovery.sql");

suite("DATA_DELETION recovery diagnostics", () => {
    test("accepts supported CREATE and ALTER TABLE forms", () => {
        assertValid(`CREATE TABLE dbo.records (created_at datetime2)
WITH (DATA_DELETION = ON (FILTER_COLUMN = created_at, RETENTION_PERIOD = 1 DAY));`);
        assertValid(`CREATE TABLE dbo.records (created_at datetime2)
WITH (DATA_DELETION = ON (FILTER_COLUMN = created_at));`);
        assertValid("ALTER TABLE dbo.records SET (DATA_DELETION = OFF);");
        assertValid(`ALTER TABLE dbo.records SET
(DATA_DELETION = ON (RETENTION_PERIOD = INFINITE, FILTER_COLUMN = created_at));`);
    });

    test("rejects sub-options after OFF", () => {
        for (const option of ["FILTER_COLUMN = created_at", "RETENTION_PERIOD = 1 DAY"]) {
            const sql = `ALTER TABLE dbo.records SET (DATA_DELETION = OFF (${option}));`;
            const optionName = option.slice(0, option.indexOf(" "));
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [
                    "Incorrect syntax near '('.  Expecting ')', or ','.",
                    `Incorrect syntax near '${optionName}'.  Expecting '(', or SELECT.`,
                ],
                sql,
            );
        }
    });

    test("requires a filter when a retention period is supplied", () => {
        const sql = `CREATE TABLE dbo.records (created_at datetime2)
WITH (DATA_DELETION = ON (RETENTION_PERIOD = 1 DAY));`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            ["Incorrect syntax near ')'.  Expecting ','."],
        );
    });

    test("reports duplicate sub-options without cascading", () => {
        const expectation =
            "TABOPTNAME_DATA_DELETION, TABOPTNAME_FILESTREAM_ON, TABOPTNAME_FILETABLE_DIRECTORY, TABOPTNAME_LOCK_ESCALATION, TABOPTNAME_REMOTE_DATA_ARCHIVE, or TABOPTNAME_SYSTEM_VERSIONING";
        for (const duplicate of ["FILTER_COLUMN", "RETENTION_PERIOD"]) {
            const first =
                duplicate === "FILTER_COLUMN"
                    ? "FILTER_COLUMN = created_at, RETENTION_PERIOD = 1 DAY"
                    : "RETENTION_PERIOD = 1 DAY, FILTER_COLUMN = created_at";
            const value = duplicate === "FILTER_COLUMN" ? "created_at" : "1 DAY";
            const sql = `ALTER TABLE dbo.records SET (DATA_DELETION = ON (${first}, ${duplicate} = ${value}));`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [
                    "Incorrect syntax near ','.  Expecting ')'.",
                    `Incorrect syntax near '${duplicate}'.  Expecting ${expectation}.`,
                ],
                sql,
            );
        }
    });

    test("validates retention values and units", () => {
        const cases: readonly [string, string][] = [
            ["-1 DAY", "Incorrect syntax near '-'.  Expecting INFINITE, INTEGER, or NUMERIC."],
            [
                "whatever",
                "Incorrect syntax near 'whatever'.  Expecting INFINITE, INTEGER, or NUMERIC.",
            ],
            ["1 whatever", "Incorrect syntax near 'whatever'."],
            ["1 N'whatever'", "Incorrect syntax near 'N'whatever''."],
            ["1 INFINITE", "Incorrect syntax near 'INFINITE'."],
        ];
        for (const [value, expected] of cases) {
            const sql = `CREATE TABLE dbo.records (created_at datetime2)
WITH (DATA_DELETION = ON (FILTER_COLUMN = created_at, RETENTION_PERIOD = ${value}));`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                [expected],
                sql,
            );
        }
    });
});
