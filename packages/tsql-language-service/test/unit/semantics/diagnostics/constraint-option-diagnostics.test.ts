/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSemanticHarness } from "../../support/semanticHarness.ts";
// A key constraint accepts index options, but not the ones that only describe building an index.
// DROP_EXISTING and STATISTICS_ONLY are never accepted; MAXDOP, ONLINE, and SORT_IN_TEMPDB are
// accepted only by ALTER TABLE.
const { analyze, open } = createSemanticHarness({ uri: "file:///constraint-options.sql" });

suite("T-SQL key constraint index option validation", () => {
    // The report names the option and covers the option name.
    test("rejects a never-accepted constraint option with exact output", async () => {
        const sql =
            "CREATE TABLE dbo.T (Id int, CONSTRAINT pk PRIMARY KEY (Id) WITH (DROP_EXISTING = ON));";
        const diagnostics = (await analyze(sql)).filter(
            ({ code }) => code === "UnrecognizedOption",
        );

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "UnrecognizedOption",
                    message: "'DROP_EXISTING' is not a recognized option.",
                    severity: "error",
                    text: "DROP_EXISTING",
                },
            ],
        );
    });

    // Build-only options are rejected on CREATE TABLE and accepted on ALTER TABLE.
    test("separates build-only options by statement", async () => {
        for (const option of ["MAXDOP = 2", "ONLINE = ON", "SORT_IN_TEMPDB = ON"]) {
            const name = option.split(" ")[0];
            assert.deepEqual(
                (
                    await analyze(
                        `CREATE TABLE dbo.T (Id int, CONSTRAINT pk PRIMARY KEY (Id) WITH (${option}));`,
                    )
                )
                    .filter(({ code }) => code === "UnrecognizedOption")
                    .map(({ message }) => message),
                [`'${name}' is not a recognized option.`],
                option,
            );
            assert.deepEqual(
                (
                    await analyze(
                        `CREATE TABLE dbo.T (Id int);
ALTER TABLE dbo.T ADD CONSTRAINT pk PRIMARY KEY (Id) WITH (${option});`,
                    )
                ).filter(({ code }) => code === "UnrecognizedOption"),
                [],
                option,
            );
        }
    });

    // UNIQUE carries the same option rules as PRIMARY KEY.
    test("applies the rule to UNIQUE constraints", async () => {
        assert.deepEqual(
            (
                await analyze(
                    "CREATE TABLE dbo.T (Id int, CONSTRAINT u UNIQUE (Id) WITH (STATISTICS_ONLY = 0));",
                )
            )
                .filter(({ code }) => code === "UnrecognizedOption")
                .map(({ message }) => message),
            ["'STATISTICS_ONLY' is not a recognized option."],
        );
    });

    // The options a key constraint does accept stay silent.
    test("accepts the supported constraint index options", async () => {
        const sql = `CREATE TABLE dbo.T (
    Id int,
    CONSTRAINT pk PRIMARY KEY (Id)
        WITH (FILLFACTOR = 80, PAD_INDEX = ON, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON)
);`;
        assert.deepEqual(
            (await analyze(sql)).filter(({ code }) => code === "UnrecognizedOption"),
            [],
        );
    });

    // The rule belongs to key constraints, not to CREATE INDEX, where DROP_EXISTING is valid.
    test("leaves CREATE INDEX options alone", async () => {
        const sql = `CREATE TABLE dbo.T (Id int);
CREATE INDEX ix ON dbo.T (Id) WITH (DROP_EXISTING = ON, MAXDOP = 2);`;

        assert.deepEqual(
            (await analyze(sql)).filter(({ code }) => code === "UnrecognizedOption"),
            [],
        );
    });

    // Recovery inside an option value must not produce a confident option classification.
    test("does not classify a damaged constraint option list", async () => {
        const snapshot = await open(
            "CREATE TABLE dbo.T (Id int PRIMARY KEY WITH (DROP_EXISTING = ));",
        );
        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ code }) => code === "UnrecognizedOption"),
            [],
        );
    });
});
