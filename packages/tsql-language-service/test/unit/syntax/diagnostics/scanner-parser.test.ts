/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("scanner-parser.sql");

suite("T-SQL scanner and parser diagnostic coverage", () => {
    test("preserves recovery across malformed multiline strings", () => {
        const sql = `'This is the second line of the SQL script. It should be properly handled by the SQL parser.' AS line2,
    'third' AS line3;
SELECT 'another' AS line1,
    'second line
            continuation' AS line2,
    'third' AS line3;
SELECT 'last' AS line1,
    'unfinished statement' AS line2`;
        const snapshot = parse(sql);

        assert.equal(snapshot.statistics.rawErrorNodeCount, 5);
        assert.deepEqual(
            snapshot.diagnostics.map(({ code, message, range }) => ({
                code,
                message,
                source: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "syntax",
                    message:
                        "Incorrect syntax near ''This is the second line of the SQL script. It should be properly handled by the SQL parser.''.",
                    source: "'This is the second line of the SQL script. It should be properly handled by the SQL parser.'",
                },
                {
                    code: "syntax",
                    message: "Incorrect syntax near 'AS'.",
                    source: "AS",
                },
                {
                    code: "syntax",
                    message: "Incorrect syntax near ','.",
                    source: ",",
                },
                {
                    code: "syntax",
                    message: "Incorrect syntax near 'AS'.",
                    source: "AS",
                },
                {
                    code: "syntax",
                    message: "Incorrect syntax near 'line3'.",
                    source: "line3",
                },
            ],
        );
    });

    // Unterminated SQL strings produce one precise scanner message without duplicate recovery noise.
    test("reports an unclosed quotation mark", () => {
        const sql = "SELECT 'unfinished";
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "UnclosedQuotationMark",
                message: "Unclosed quotation mark after the character string ''unfinished'.",
                severity: "error",
                range: { start: 7, end: sql.length },
            },
        ]);
    });

    test("reports unclosed quoted and bracketed identifiers", () => {
        const cases = [
            ['SET QUOTED_IDENTIFIER ON; SELECT * FROM db."foo', '"foo'],
            ["SELECT * FROM db.[foo", "[foo"],
            ["SELECT * FROM [t]]", "[t]]"],
        ] as const;

        for (const [sql, value] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ code, message, range }) => ({
                    code,
                    message,
                    text: sql.slice(range.start, range.end),
                })),
                [
                    {
                        code: "UnclosedQuotationMark",
                        message: `Unclosed quotation mark after the character string '${value}'.`,
                        text: value,
                    },
                ],
                sql,
            );
        }
    });

    // SQL numeric literals enforce SQL Server's maximum 38-digit representation boundary.
    test("reports numeric precision overflow", () => {
        const value = "123456789012345678901234567890123456789";
        assert.deepEqual(
            parse(`SELECT ${value};`).diagnostics.map(({ message }) => message),
            [
                `The number '${value}' is out of the range for numeric representation (maximum precision 38).`,
            ],
        );
    });

    // Decimal tokens in an integer-only option remain intact for a precise diagnostic.
    test("reports a decimal value where an integer is required", () => {
        assert.deepEqual(
            parse("SET TEXTSIZE 1.5;").diagnostics.map(({ message }) => message),
            ["The integer value 1.5 is out of range."],
        );
    });

    test("reports non-integral and overflowing data type arguments", () => {
        const sql = `CREATE TABLE t(
    a decimal(5.5, 10),
    b decimal(10, 2.5),
    c varchar(2147483648),
    d time(5.5)
);`;
        assert.deepEqual(
            parse(sql)
                .diagnostics.filter(({ code }) => code === "IntegerValueOutOfRange")
                .map(({ message }) => message),
            [
                "The integer value 5.5 is out of range.",
                "The integer value 2.5 is out of range.",
                "The integer value 2147483648 is out of range.",
                "The integer value 5.5 is out of range.",
            ],
        );
    });

    test("enforces the signed 32-bit range in integer-only contexts", () => {
        const cases = [
            ["SET TEXTSIZE 2147483648;", "2147483648"],
            ["SET TEXTSIZE -2147483649;", "2147483649"],
        ] as const;
        for (const [sql, value] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ code, message }) => ({ code, message })),
                [
                    {
                        code: "IntegerValueOutOfRange",
                        message: `The integer value ${value} is out of range.`,
                    },
                ],
            );
        }
        assert.deepEqual(parse("SET TEXTSIZE -2147483648;").diagnostics, []);
    });

    // The ODBC escape grammar deliberately accepts an identifier so the validator can name it.
    test("reports an invalid ODBC datetime option", () => {
        assert.deepEqual(
            parse("SELECT {xx '2020-01-01'};").diagnostics.map(({ message }) => message),
            ["'xx' is not a recognized ODBC date/time extension option."],
        );
    });

    // Login ON/OFF switches report the option and rejected value instead of generic recovery.
    test("reports an invalid login option value", () => {
        assert.deepEqual(
            parse("CREATE LOGIN x WITH PASSWORD='secret', CHECK_POLICY=BAD;").diagnostics.map(
                ({ message }) => message,
            ),
            ["'BAD' in not a correct value for option 'CHECK_POLICY'."],
        );
    });

    // Reserved words use SQL Server's keyword-specific recovery message at the rejected token.
    test("identifies a reserved keyword in a syntax error", () => {
        assert.deepEqual(parse("SELECT 1 FROM FROM dbo.Items;").diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'FROM'.",
                severity: "error",
                range: { start: 14, end: 18 },
            },
        ]);
    });

    // FOR XML and FOR JSON option combinations produce targeted diagnostics instead of recovery noise.
    test("validates FOR XML and FOR JSON option combinations", () => {
        const sql = `SELECT 1 FOR XML AUTO('row');
SELECT 1 FOR XML PATH, XMLSCHEMA;
SELECT 1 FOR XML EXPLICIT, ELEMENTS;
SELECT 1 FOR XML AUTO, INCLUDE_NULL_VALUES;
SELECT 1 FOR XML AUTO, WITHOUT_ARRAY_WRAPPER;
SELECT 1 FOR JSON AUTO, BINARY BASE64;
SELECT 1 FOR JSON AUTO, TYPE;
SELECT 1 FOR JSON PATH, XMLSCHEMA;
SELECT 1 FOR JSON PATH, XMLDATA;`;
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Row tag name is only allowed with RAW or PATH mode of FOR XML.",
                "Inline schema is not supported with FOR XML PATH.",
                "ELEMENTS option is only allowed in RAW, AUTO, and PATH modes of FOR XML.",
                "INCLUDE_NULL_VALUES is only allowed in FOR JSON.",
                "WITHOUT_ARRAY_WRAPPER is only allowed in FOR JSON.",
                "BINARY BASE64 option is not allowed in FOR JSON.",
                "TYPE option is not allowed in FOR JSON.",
                "Inline schema is not supported with FOR XML PATH.",
                "Inline schema is not supported with FOR XML PATH.",
            ],
        );
    });
});
