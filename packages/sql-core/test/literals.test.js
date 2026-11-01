/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    quoteSqlIdentifier,
    sqlBigIntLiteral,
    sqlDateTime2UtcLiteral,
    sqlDateTimeOffsetLiteral,
    sqlIntLiteral,
    sqlNStringLiteral,
} = require("../dist/index.js");

suite("literals", () => {
    test("writes bigint IDs above the safe integer range exactly", () => {
        assert.equal(
            sqlBigIntLiteral("9223372036854775807"),
            "CAST(9223372036854775807 AS bigint)",
        );
        assert.equal(sqlBigIntLiteral(42), "CAST(42 AS bigint)");
        assert.equal(sqlBigIntLiteral(-7n), "CAST(-7 AS bigint)");
    });

    test("rejects values that are not bigint", () => {
        assert.throws(() => sqlBigIntLiteral("42; DROP TABLE t"), RangeError);
        assert.throws(() => sqlBigIntLiteral("9223372036854775808"), RangeError);
        assert.throws(() => sqlBigIntLiteral(1.5), RangeError);
    });

    test("checks integer ranges", () => {
        assert.equal(sqlIntLiteral(25, 1, 1000), "25");
        assert.throws(() => sqlIntLiteral(0, 1, 1000), RangeError);
        assert.throws(() => sqlIntLiteral(2.5, 1, 1000), RangeError);
    });

    test("writes UTC date literals", () => {
        const value = new Date(Date.UTC(2026, 9, 8, 6, 30, 0, 125));
        assert.equal(
            sqlDateTimeOffsetLiteral(value),
            "CAST(N'2026-10-08T06:30:00.125Z' AS datetimeoffset)",
        );
        assert.equal(
            sqlDateTime2UtcLiteral(value),
            "CAST(N'2026-10-08T06:30:00.125' AS datetime2)",
        );
        assert.throws(() => sqlDateTimeOffsetLiteral(new Date(Number.NaN)), RangeError);
    });

    test("escapes strings and identifiers", () => {
        assert.equal(sqlNStringLiteral("O'Brien"), "N'O''Brien'");
        assert.equal(quoteSqlIdentifier("odd]name"), "[odd]]name]");
        assert.throws(() => quoteSqlIdentifier(""), RangeError);
        assert.throws(() => quoteSqlIdentifier("x".repeat(129)), RangeError);
    });
});
