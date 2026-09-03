/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { analyzeSql, createMetadata } from "../../support/semanticHarness.ts";

async function analyze(sql: string) {
    return analyzeSql(sql, createMetadata(), { allowSyntaxDiagnostics: true, snapshot: true });
}

suite("T-SQL diagnostic context regressions", () => {
    test("does not cascade semantic errors from recovered procedure syntax", async () => {
        const snapshot = await analyze("CREATE PROC p(value int) AS (SELECT 1 SELECT missing / 0)");
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ code }) =>
                ["BooleanConditionExpected", "ParamVarHasInvalidDataType"].includes(code),
            ),
            [],
        );
    });

    test("does not treat a recovered column type as a function call", async () => {
        const snapshot = await analyze(`CREATE TABLE t (
 c1 int MASKED WITH (FUNCTION = 'default()')
 c2 varchar(32) MASKED WITH (FUNCTION = 'email()')
);`);
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(
                ({ code }) => code === "NotRecognizedFunctionName",
            ),
            [],
        );
    });

    test("rejects zero length or precision while retaining valid zero temporal scale", async () => {
        const snapshot = await analyze(`CREATE TABLE t(c uniqueidentifier(0), d time(0));
CREATE TYPE alias FROM varchar(0) NULL;`);
        assert.deepEqual(
            snapshot.semantics.diagnostics
                .filter(({ code }) => code === "InvalidLengthOrPrecision")
                .map(({ message }) => message),
            [
                "Length or precision specification 0 is invalid.",
                "Length or precision specification 0 is invalid.",
            ],
        );
    });

    test("does not add range diagnostics for invalid integer data type arguments", async () => {
        const snapshot = await analyze(`CREATE TABLE t(
    a decimal(2147483648, 2147483648),
    b decimal(5.5, 10),
    c varchar(2147483648)
);`);
        assert.deepEqual(
            snapshot.syntax.diagnostics
                .filter(({ code }) => code === "IntegerValueOutOfRange")
                .map(({ message }) => message),
            [
                "The integer value 2147483648 is out of range.",
                "The integer value 2147483648 is out of range.",
                "The integer value 5.5 is out of range.",
                "The integer value 2147483648 is out of range.",
            ],
        );
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ code }) =>
                [
                    "InvalidLengthOrPrecision",
                    "InvalidScale",
                    "MaximumSizeError",
                    "MaximumSizeErrorForAnyType",
                    "ScalePrecisionMismatch",
                ].includes(code),
            ),
            [],
        );
    });

    test("validates legacy constraint fillfactor values", async () => {
        const snapshot =
            await analyze(`CREATE TABLE high_value(c int PRIMARY KEY WITH FILLFACTOR = 200);
CREATE TABLE fractional(c int PRIMARY KEY WITH FILLFACTOR = 50.5);
CREATE TABLE overflow(c int PRIMARY KEY WITH FILLFACTOR = 2147483648);
CREATE TABLE parenthesized_overflow(c int PRIMARY KEY WITH (FILLFACTOR = 2147483648));
CREATE TABLE valid_value(c int PRIMARY KEY WITH FILLFACTOR = 80);`);
        assert.deepEqual(
            [...snapshot.syntax.diagnostics, ...snapshot.semantics.diagnostics]
                .filter(({ code }) =>
                    ["InvalidFillFactorPercentage", "IntegerValueOutOfRange"].includes(code),
                )
                .map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "IntegerValueOutOfRange",
                    message: "The integer value 2147483648 is out of range.",
                },
                {
                    code: "InvalidFillFactorPercentage",
                    message:
                        "Fillfactor 200 is not a valid percentage; fillfactor must be between 1 and 100.",
                },
                {
                    code: "IntegerValueOutOfRange",
                    message: "The integer value 50.5 is out of range.",
                },
                {
                    code: "IntegerValueOutOfRange",
                    message: "The integer value 2147483648 is out of range.",
                },
            ],
        );
    });

    test("validates options on named key constraints", async () => {
        const snapshot = await analyze(`CREATE TABLE create_column(
    c int CONSTRAINT pk_column PRIMARY KEY WITH (DROP_EXISTING = ON)
);
CREATE TABLE create_table(
    c int,
    CONSTRAINT pk_table PRIMARY KEY(c) WITH (STATISTICS_ONLY = 0)
);
CREATE TABLE create_build(
    c int CONSTRAINT pk_build PRIMARY KEY WITH (MAXDOP = 2)
);
ALTER TABLE target ADD c int CONSTRAINT pk_alter PRIMARY KEY WITH (DROP_EXISTING = ON);`);
        assert.deepEqual(
            snapshot.semantics.diagnostics
                .filter(({ code }) => code === "UnrecognizedOption")
                .map(({ message }) => message),
            [
                "'DROP_EXISTING' is not a recognized option.",
                "'STATISTICS_ONLY' is not a recognized option.",
                "'MAXDOP' is not a recognized option.",
                "'DROP_EXISTING' is not a recognized option.",
            ],
        );
    });

    test("validates positional arguments after a named EXECUTE argument without catalog metadata", async () => {
        const cases = [
            ["EXECUTE p @a = 1, 2, 3;", 2],
            ["EXECUTE p 1, @b = 2, 3;", 3],
        ] as const;
        for (const [sql, position] of cases) {
            const snapshot = await analyze(sql);
            assert.deepEqual(
                snapshot.semantics.diagnostics
                    .filter(({ code }) => code === "InconsistentParameterFormat")
                    .map(({ message }) => message),
                [
                    `Must pass parameter number ${position} and subsequent parameters as '@name = value'. After the form '@name = value' has been used, all subsequent parameters must be passed in the form '@name = value'.`,
                ],
                sql,
            );
        }
    });

    test("identifies invalid routine and cursor-variable options", async () => {
        const cases = [
            ["DECLARE @i CURSOR READONLY;", "READONLY", "READONLY"],
            ["DECLARE @i CURSOR OUTPUT;", "OUTPUT", "OUTPUT"],
            ["DECLARE @i CURSOR INPUT;", "INPUT", "INPUT"],
            ["CREATE PROC p @p int INPUT AS SELECT 1;", "INPUT", "INPUT"],
            ["EXECUTE p '1' INPUT;", "INPUT", "INPUT"],
            ["EXECUTE p @value = 1 INPUT;", "INPUT", "INPUT"],
            [
                "CREATE FUNCTION f(@p int INPUT) RETURNS int AS BEGIN RETURN 1 END;",
                "INPUT",
                "INPUT",
            ],
            ["CREATE FUNCTION f(@p int OUT) RETURNS int AS BEGIN RETURN 1 END;", "OUTPUT", "OUT"],
        ] as const;
        for (const [sql, option, source] of cases) {
            const snapshot = await analyze(sql);
            assert.deepEqual(
                [...snapshot.syntax.diagnostics, ...snapshot.semantics.diagnostics]
                    .filter(({ code }) => code === "OptionNotRecognized")
                    .map(({ message, range }) => ({
                        message,
                        text: sql.slice(range.start, range.end),
                    })),
                [{ message: `'${option}' is not a recognized option.`, text: source }],
                sql,
            );
        }
    });

    test("rejects SELECT INTO inside view definitions", async () => {
        for (const operation of ["CREATE", "ALTER"] as const) {
            const sql = `${operation} VIEW v AS SELECT * INTO t FROM s;`;
            const snapshot = await analyze(sql);
            assert.deepEqual(
                snapshot.syntax.diagnostics.map(({ message }) => message),
                ["Incorrect syntax near 'INTO'."],
                sql,
            );
            assert.deepEqual(
                snapshot.semantics.diagnostics
                    .filter(({ code }) => code === "MustBeOnlyStatementInBatch")
                    .map(({ message }) => message),
                [`Incorrect syntax: '${operation} VIEW' must be the only statement in the batch.`],
                sql,
            );
        }
    });

    test("validates filtered-index predicates and target prefix count", async () => {
        const snapshot = await analyze(`CREATE INDEX bad_filter ON t(c) WHERE c > (10 + 20);
CREATE INDEX valid_filter ON t(c) WHERE c > 10 AND c < 20;
CREATE INDEX too_many_parts ON server.database.schema_name.table_name(c);`);
        assert.deepEqual(
            snapshot.semantics.diagnostics
                .filter(({ code }) =>
                    ["IncorrectWhereClauseForFilteredIndex", "TypeNameMaxPrefixError"].includes(
                        code,
                    ),
                )
                .map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "IncorrectWhereClauseForFilteredIndex",
                    message: "Incorrect WHERE clause for filtered index 'bad_filter' on table 't'.",
                },
                {
                    code: "TypeNameMaxPrefixError",
                    message:
                        "The type name 'server.database.schema_name.table_name' contains more than the maximum number of prefixes. The maximum is 2.",
                },
            ],
        );
    });

    test("validates trigger, login, and function option contexts", async () => {
        const snapshot =
            await analyze(`CREATE TRIGGER invalid_append ON t AFTER INSERT WITH APPEND AS SELECT 1;
GO
CREATE TRIGGER valid_append ON t FOR INSERT WITH APPEND AS SELECT 1;
GO
CREATE LOGIN external_login FROM EXTERNAL PROVIDER WITH DEFAULT_DATABASE=db1, DEFAULT_DATABASE=db2;
CREATE LOGIN windows_login FROM WINDOWS WITH DEFAULT_DATABASE=db1, DEFAULT_DATABASE=db2;
CREATE LOGIN certificate_login FROM CERTIFICATE cert WITH CREDENTIAL=cred1, CREDENTIAL=cred2;
CREATE LOGIN asymmetric_login FROM ASYMMETRIC KEY asym WITH CREDENTIAL=cred1, CREDENTIAL=cred2;
CREATE FUNCTION duplicate_option() RETURNS int WITH RETURNS NULL ON NULL INPUT, RETURNS NULL ON NULL INPUT AS BEGIN RETURN 1; END;
GO
CREATE FUNCTION invalid_clr_option() RETURNS int WITH INLINE = ON AS EXTERNAL NAME a.b.c;`);
        assert.deepEqual(
            snapshot.semantics.diagnostics
                .filter(({ code }) =>
                    [
                        "OptionNotRecognized",
                        "OptionSpecifiedMultipleTimes",
                        "InvalidOptionInCreateFunction",
                    ].includes(code),
                )
                .map(({ code, message }) => ({ code, message })),
            [
                { code: "OptionNotRecognized", message: "'APPEND' is not a recognized option." },
                {
                    code: "OptionSpecifiedMultipleTimes",
                    message: "Option 'DEFAULT_DATABASE' is specified more than once.",
                },
                {
                    code: "OptionSpecifiedMultipleTimes",
                    message: "Option 'DEFAULT_DATABASE' is specified more than once.",
                },
                {
                    code: "OptionSpecifiedMultipleTimes",
                    message: "Option 'CREDENTIAL' is specified more than once.",
                },
                {
                    code: "OptionSpecifiedMultipleTimes",
                    message: "Option 'CREDENTIAL' is specified more than once.",
                },
                {
                    code: "OptionSpecifiedMultipleTimes",
                    message: "Option 'RETURNS NULL ON NULL INPUT' is specified more than once.",
                },
                {
                    code: "InvalidOptionInCreateFunction",
                    message:
                        'An invalid option was specified for the statement "CREATE/ALTER FUNCTION".',
                },
            ],
        );
    });

    test("retains CREATE SCHEMA diagnostics for an incomplete AUTHORIZATION clause", async () => {
        for (const sql of ["CREATE SCHEMA AUTHORIZATION", "CREATE SCHEMA s AUTHORIZATION"]) {
            const snapshot = await analyze(sql);
            assert.deepEqual(
                snapshot.semantics.diagnostics
                    .filter(({ code }) => code === "MustBeOnlyStatementInBatch")
                    .map(({ message }) => message),
                ["Incorrect syntax: 'CREATE SCHEMA' must be the only statement in the batch."],
                sql,
            );
        }
        const unnamed = await analyze("CREATE SCHEMA AUTHORIZATION");
        assert.deepEqual(
            unnamed.syntax.diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "NameOrAuthorizationKeywordRequired",
                    message:
                        "The CREATE SCHEMA statement should be followed by a name or authorization keyword.",
                },
                {
                    code: "syntax",
                    message: "Incorrect syntax near 'End Of File'.  Expecting ID, or QUOTED_ID.",
                },
            ],
        );
    });
});
