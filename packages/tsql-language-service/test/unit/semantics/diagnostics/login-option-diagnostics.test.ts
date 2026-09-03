/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { analyzeSql, createMetadata } from "../../support/semanticHarness.ts";

async function diagnostics(sql: string) {
    const snapshot = await analyzeSql(sql, createMetadata(), {
        allowSyntaxDiagnostics: true,
        snapshot: true,
    });
    return [...snapshot.syntax.diagnostics, ...snapshot.semantics.diagnostics].map(
        ({ code, message, range }) => ({ code, message, text: sql.slice(range.start, range.end) }),
    );
}

suite("T-SQL login option diagnostics", () => {
    test("reports duplicate password and credential options", async () => {
        for (const operation of ["CREATE", "ALTER"] as const) {
            const sql = `${operation} LOGIN l WITH PASSWORD='p', credential=a, credential=b;`;
            assert.deepEqual(
                (await diagnostics(sql)).filter(
                    ({ code }) => code === "OptionSpecifiedMultipleTimes",
                ),
                [
                    {
                        code: "OptionSpecifiedMultipleTimes",
                        message: "Option 'CREDENTIAL' is specified more than once.",
                        text: "credential=b",
                    },
                ],
                sql,
            );
        }
    });

    test("validates password modifier duplication and order", async () => {
        const cases = [
            [
                "ALTER LOGIN l WITH PASSWORD=0x01 HASHED HASHED;",
                "OptionSpecifiedMultipleTimes",
                "Option 'HASHED' is specified more than once.",
            ],
            [
                "ALTER LOGIN l WITH PASSWORD=0x01 MUST_CHANGE HASHED;",
                "IncorrectOptionOrder",
                "'HASHED' is specified at incorrect location.",
            ],
            [
                "CREATE LOGIN l WITH PASSWORD='p' MUST_CHANGE MUST_CHANGE;",
                "OptionSpecifiedMultipleTimes",
                "Option 'MUST_CHANGE' is specified more than once.",
            ],
        ] as const;
        for (const [sql, code, message] of cases) {
            assert.deepEqual(
                (await diagnostics(sql))
                    .filter((diagnostic) => diagnostic.code === code)
                    .map((diagnostic) => diagnostic.message),
                [message],
                sql,
            );
        }
    });

    test("requires HASHED exactly for binary password values", async () => {
        for (const sql of [
            "CREATE LOGIN l WITH PASSWORD=0x01;",
            "ALTER LOGIN l WITH PASSWORD=0x01;",
            "CREATE LOGIN l WITH PASSWORD='p' HASHED;",
            "ALTER LOGIN l WITH PASSWORD='p' HASHED;",
        ]) {
            assert.deepEqual(
                (await diagnostics(sql))
                    .filter(({ code }) => code === "IncorrectSyntaxNear")
                    .map(({ message }) => message),
                [`Incorrect syntax near '${/0x/u.test(sql) ? "0x01" : "'p'"}'.`],
                sql,
            );
        }
        for (const sql of [
            "CREATE LOGIN l WITH PASSWORD='p';",
            "ALTER LOGIN l WITH PASSWORD='p';",
            "CREATE LOGIN l WITH PASSWORD=0x01 HASHED;",
            "ALTER LOGIN l WITH PASSWORD=0x01 HASHED;",
        ]) {
            assert.equal(
                (await diagnostics(sql)).some(({ code }) => code === "IncorrectSyntaxNear"),
                false,
                sql,
            );
        }
    });

    test("reports unknown and context-invalid modifiers", async () => {
        assert.deepEqual(
            (await diagnostics("CREATE LOGIN l WITH PASSWORD='p' foo;"))
                .filter(({ code }) => code === "OptionNotRecognized")
                .map(({ message }) => message),
            ["'foo' is not a recognized option."],
        );
        assert.deepEqual(
            (await diagnostics("ALTER LOGIN l WITH PASSWORD=0x01 HASHED UNLOCK;"))
                .filter(({ code }) => code === "OptionNotRecognized")
                .map(({ message }) => message),
            ["'UNLOCK' is not a recognized option."],
        );
    });

    test("reports unknown Windows and external-provider login options", async () => {
        for (const source of ["WINDOWS", "EXTERNAL PROVIDER"] as const) {
            const sql = `CREATE LOGIN l FROM ${source} WITH foo=bar;`;
            assert.deepEqual(await diagnostics(sql), [
                {
                    code: "OptionNotRecognized",
                    message: "'foo' is not a recognized option.",
                    text: "foo",
                },
            ]);
        }
    });

    test("reports an unknown assigned password-login option once", async () => {
        const sql = "CREATE LOGIN l WITH PASSWORD='p', foo=bar;";
        assert.deepEqual(
            (await diagnostics(sql)).filter(({ code }) => code === "OptionNotRecognized"),
            [
                {
                    code: "OptionNotRecognized",
                    message: "'foo' is not a recognized option.",
                    text: "foo",
                },
            ],
        );
    });

    test("reports invalid principal option values with source spelling", async () => {
        for (const [option, value] of [
            ["credential", "ON"],
            ["default_database", "ON"],
            ["default_language", "ON"],
            ["name", "ON"],
            ["sid", "foo"],
            ["check_policy", "foo"],
            ["check_expiration", "foo"],
        ] as const) {
            const sql = `CREATE LOGIN l WITH PASSWORD='p', ${option}=${value};`;
            assert.deepEqual(
                (await diagnostics(sql))
                    .filter(({ code }) => code === "IncorrectOptionValue")
                    .map(({ message }) => message),
                [`'${value}' in not a correct value for option '${option}'.`],
                sql,
            );
        }
    });
});
