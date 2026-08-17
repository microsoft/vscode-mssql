/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// The SET grammar keeps option names as identifiers so a misspelling keeps an exact range instead
// of collapsing into recovery. These tests are the other half of that trade: they prove an
// unrecognized name or an unsupported value shape still produces a diagnostic rather than being
// silently accepted by the shared production.
const { createSemanticHarness } = require("../../support/semanticHarness.js");
const { analyze } = createSemanticHarness({ uri: "file:///set-options.sql" });

const codesAndMessages = async (sql) =>
    (await analyze(sql)).map(({ code, message }) => [code, message]);

suite("T-SQL SET option validation", () => {
    // The exact reproduction named in the milestone acceptance criteria.
    test("rejects an unrecognized named-value option with exact output", async () => {
        const sql = "SET BANANA POTATO;";
        const diagnostics = await analyze(sql);

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
                    message: "'BANANA' is not a recognized option.",
                    severity: "error",
                    text: "BANANA",
                },
            ],
        );
    });

    // The same name in the bare on/off list form must not slip through either.
    test("rejects an unrecognized option in the on/off list form", async () => {
        assert.deepEqual(await codesAndMessages("SET BANANA ON;"), [
            ["UnrecognizedOption", "'BANANA' is not a recognized option."],
        ]);
    });

    // A recognized neighbour in the same list must not mask an unrecognized one.
    test("rejects an unrecognized option beside a recognized one", async () => {
        assert.deepEqual(await codesAndMessages("SET NOCOUNT, BANANA ON;"), [
            ["UnrecognizedOption", "'BANANA' is not a recognized option."],
        ]);
    });

    // Each named-value option accepts a specific value family; a wrong shape is reported.
    test("rejects unsupported value shapes per option", async () => {
        assert.deepEqual(await codesAndMessages("SET DEADLOCK_PRIORITY BANANA;"), [
            [
                "IncorrectOptionValue",
                "'BANANA' in not a correct value for option 'DEADLOCK_PRIORITY'.",
            ],
        ]);
        assert.deepEqual(await codesAndMessages("SET LOCK_TIMEOUT abc;"), [
            ["IncorrectOptionValue", "'abc' in not a correct value for option 'LOCK_TIMEOUT'."],
        ]);
        assert.deepEqual(await codesAndMessages("SET DATEFIRST xyz;"), [
            ["IncorrectOptionValue", "'xyz' in not a correct value for option 'DATEFIRST'."],
        ]);
    });

    // FIPS_FLAGGER turns flagging off through the toggle list and selects a level through the
    // value form; ON is rejected outright, and an unknown level is not a valid value.
    test("enforces the FIPS_FLAGGER value domain", async () => {
        assert.deepEqual(await codesAndMessages("SET FIPS_FLAGGER off;"), []);
        assert.deepEqual(await codesAndMessages("SET FIPS_FLAGGER 'entry';"), []);
        assert.deepEqual(await codesAndMessages("SET FIPS_FLAGGER on;"), [
            ["IncorrectOptionValue", "'ON' in not a correct value for option 'FIPS_FLAGGER'."],
        ]);
        assert.deepEqual(await codesAndMessages("SET FIPS_FLAGGER 'banana';"), [
            [
                "IncorrectOptionValue",
                "''banana'' in not a correct value for option 'FIPS_FLAGGER'.",
            ],
        ]);
    });

    // Every documented option family stays clean so the validation cannot regress into false
    // positives on ordinary session setup.
    test("accepts recognized SET statements without diagnostics", async () => {
        for (const sql of [
            "SET NOCOUNT ON;",
            "SET NOCOUNT, ANSI_NULLS, QUOTED_IDENTIFIER ON;",
            "SET ARITHABORT, ANSI_PADDING OFF;",
            "SET LANGUAGE us_english;",
            "SET LANGUAGE 'russian', DATEFORMAT ymd;",
            "SET DEADLOCK_PRIORITY LOW;",
            "SET DEADLOCK_PRIORITY -5;",
            "DECLARE @priority int = 5;\nSET DEADLOCK_PRIORITY @priority;",
            "SET LOCK_TIMEOUT -1;",
            "SET DATEFIRST 7, QUERY_GOVERNOR_COST_LIMIT 0;",
            "SET CONTEXT_INFO 0x10000;",
            "SET STATISTICS IO, TIME ON;",
            "SET TEXTSIZE 2048;",
            "SET ERRLVL 16;",
            "SET ROWCOUNT 100;",
            "SET TRANSACTION ISOLATION LEVEL SNAPSHOT;",
            "SET IDENTITY_INSERT dbo.Target ON;",
        ]) {
            assert.deepEqual(await analyze(sql), [], `expected no diagnostics for ${sql}`);
        }
    });

    // A variable defers its value to run time, so no value-shape diagnostic may be invented.
    test("does not judge a variable option value", async () => {
        assert.deepEqual(
            await codesAndMessages("DECLARE @wait int = 1;\nSET LOCK_TIMEOUT @wait;"),
            [],
        );
        assert.deepEqual(
            await codesAndMessages("DECLARE @lang sysname = N'us_english';\nSET LANGUAGE @lang;"),
            [],
        );
    });
});
