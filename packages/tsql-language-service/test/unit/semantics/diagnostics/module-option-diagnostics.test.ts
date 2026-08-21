/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSemanticHarness } from "../../support/semanticHarness.ts";
// The module grammar accepts any identifier inside a WITH clause and then classifies it: an unknown
// name is unrecognized, a known module option outside the statement's option mask is invalid for
// that statement, and only a valid option can be reported as a repeat.
const { analyze } = createSemanticHarness({ uri: "file:///module-options.sql" });

suite("T-SQL module option validation", () => {
    // VIEW_METADATA is a real module option that CREATE/ALTER PROCEDURE does not accept.
    test("reports a misplaced procedure option with exact output", async () => {
        const sql = "CREATE PROCEDURE dbo.p WITH VIEW_METADATA AS SELECT 1;";
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
                    code: "InvalidOptionInCreateProcedure",
                    message:
                        'An invalid option was specified for the statement "CREATE/ALTER PROCEDURE".',
                    severity: "error",
                    text: "VIEW_METADATA",
                },
            ],
        );
    });

    // RECOMPILE and VIEW_METADATA are module options outside the CREATE/ALTER TRIGGER option mask.
    test("reports misplaced trigger options with exact output", async () => {
        const sql =
            "CREATE TRIGGER t ON dbo.c WITH RECOMPILE, VIEW_METADATA AFTER INSERT AS BEGIN RETURN; END;";
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            ["RECOMPILE", "VIEW_METADATA"].map((option) => ({
                code: "InvalidOptionInCreateTrigger",
                message:
                    'An invalid option was specified for the statement "CREATE/ALTER TRIGGER".',
                severity: "error",
                text: option,
            })),
        );
    });

    // Every option inside each statement's mask must stay silent, including the EXECUTE AS form.
    test("accepts the options each module statement allows", async () => {
        assert.deepEqual(
            await analyze(
                "CREATE PROCEDURE dbo.p WITH ENCRYPTION, RECOMPILE, EXECUTE AS OWNER AS SELECT 1;",
            ),
            [],
        );
        assert.deepEqual(
            await analyze(`CREATE PROCEDURE dbo.native WITH NATIVE_COMPILATION, SCHEMABINDING
AS SELECT 1;`),
            [],
        );
        assert.deepEqual(
            await analyze(
                "CREATE TRIGGER t ON dbo.c WITH ENCRYPTION, EXECUTE AS CALLER AFTER INSERT AS BEGIN RETURN; END;",
            ),
            [],
        );
        assert.deepEqual(
            await analyze(`CREATE TRIGGER t ON dbo.c WITH NATIVE_COMPILATION, SCHEMABINDING
AFTER INSERT AS BEGIN RETURN; END;`),
            [],
        );
    });

    // An unknown name is not a misplaced option: it is reported once as unrecognized.
    test("separates unrecognized names from misplaced options", async () => {
        assert.deepEqual(
            (await analyze("CREATE PROCEDURE dbo.p WITH MADE_UP AS SELECT 1;")).map(
                ({ code, message }) => [code, message],
            ),
            [["OptionNotRecognized", "'MADE_UP' is not a recognized option."]],
        );
        assert.deepEqual(
            (
                await analyze(
                    "CREATE TRIGGER t ON dbo.c WITH MADE_UP AFTER INSERT AS BEGIN RETURN; END;",
                )
            ).map(({ code, message }) => [code, message]),
            [["OptionNotRecognized", "'MADE_UP' is not a recognized option."]],
        );
    });

    // A repeat is only reported for an option the statement actually allows, and a misplaced
    // option reports the statement mismatch rather than a duplicate.
    test("reports one classification per option", async () => {
        assert.deepEqual(
            (await analyze("CREATE PROCEDURE dbo.p WITH ENCRYPTION, ENCRYPTION AS SELECT 1;")).map(
                ({ code, message }) => [code, message],
            ),
            [["OptionSpecifiedMultipleTimes", "Option 'ENCRYPTION' is specified more than once."]],
        );
        assert.deepEqual(
            (
                await analyze(
                    "CREATE PROCEDURE dbo.p WITH VIEW_METADATA, VIEW_METADATA AS SELECT 1;",
                )
            ).map(({ code }) => code),
            ["InvalidOptionInCreateProcedure", "InvalidOptionInCreateProcedure"],
        );
    });

    // Every statement spelling that builds a procedure or trigger definition validates its options.
    // ALTER also reports its own missing-target diagnostic, which option validation must not absorb.
    test("applies to every CREATE, CREATE OR ALTER, and ALTER spelling", async () => {
        for (const prefix of ["CREATE", "CREATE OR ALTER", "ALTER"]) {
            assert.deepEqual(
                (await analyze(`${prefix} PROCEDURE dbo.p WITH VIEW_METADATA AS SELECT 1;`))
                    .map(({ code }) => code)
                    .filter((code) => code.startsWith("InvalidOptionInCreate")),
                ["InvalidOptionInCreateProcedure"],
                prefix,
            );
            assert.deepEqual(
                (
                    await analyze(
                        `${prefix} TRIGGER t ON dbo.c WITH RECOMPILE AFTER INSERT AS BEGIN RETURN; END;`,
                    )
                )
                    .map(({ code }) => code)
                    .filter((code) => code.startsWith("InvalidOptionInCreate")),
                ["InvalidOptionInCreateTrigger"],
                prefix,
            );
        }
    });

    // A delimited option name carries the same classification as its ordinary spelling.
    test("classifies quoted and bracketed option names", async () => {
        assert.deepEqual(
            (await analyze("CREATE PROCEDURE dbo.p WITH [VIEW_METADATA] AS SELECT 1;")).map(
                ({ code }) => code,
            ),
            ["InvalidOptionInCreateProcedure"],
        );
        assert.deepEqual(
            (await analyze('CREATE PROCEDURE dbo.p WITH "view_metadata" AS SELECT 1;')).map(
                ({ code }) => code,
            ),
            ["InvalidOptionInCreateProcedure"],
        );
    });

    // A damaged option list must not produce a semantic option diagnostic on recovery nodes.
    test("stays silent on a malformed option list", async () => {
        const diagnostics = await analyze(
            "CREATE PROCEDURE dbo.p WITH , VIEW_METADATA AS SELECT 1;",
            {
                allowSyntaxDiagnostics: true,
            },
        );

        assert.deepEqual(
            diagnostics.filter(({ code }) => code === "InvalidOptionInCreateProcedure"),
            [],
        );
    });
});
