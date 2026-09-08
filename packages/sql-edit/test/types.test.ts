/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The types that break a naive encoder. Each one is here because getting it wrong corrupts data
 * rather than failing loudly.
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";

import { SqlEditError } from "../src/core/sql";
import { encodeValue, isWritableType } from "../src/types/valueCodec";
import { column } from "./fixtures";

const encode = (typeName: string, value: string | null, overrides = {}) =>
    encodeValue(value, column("C", typeName, overrides), "C");

void test("integers are range checked against their own type", () => {
    assert.equal(encode("int", "42"), "42");
    assert.equal(encode("bigint", "-9223372036854775808"), "-9223372036854775808");
    assert.throws(() => encode("tinyint", "256"), SqlEditError);
    assert.throws(() => encode("smallint", "32768"), SqlEditError);
    assert.throws(() => encode("int", "2147483648"), SqlEditError);
    assert.throws(() => encode("int", "1.5"), SqlEditError);
});

void test("bit accepts the words people actually type", () => {
    for (const yes of ["1", "true", "True", "yes"]) {
        assert.equal(encode("bit", yes), "1");
    }
    for (const no of ["0", "false", "no"]) {
        assert.equal(encode("bit", no), "0");
    }
    assert.throws(() => encode("bit", "maybe"), SqlEditError);
});

void test("dates are sent as unambiguous ISO 8601, not the server's locale", () => {
    // Style 126 is what stops 03/04 being read as March or April depending on the server.
    assert.match(encode("date", "2026-09-07") as string, /CONVERT\(date, N'2026-09-07', 126\)/);
    assert.match(
        encode("datetime2", "2026-09-07 14:30:00") as string,
        /CONVERT\(datetime2, N'2026-09-07T14:30:00', 126\)/,
    );
    assert.throws(() => encode("date", "07/09/2026"), SqlEditError);
});

void test("datetimeoffset keeps its offset", () => {
    assert.match(
        encode("datetimeoffset", "2026-09-07T14:30:00+01:00") as string,
        /CONVERT\(datetimeoffset, N'2026-09-07T14:30:00\+01:00', 127\)/,
    );
    assert.throws(() => encode("datetimeoffset", "2026-09-07T14:30:00"), SqlEditError);
});

void test("time is validated so a stray date cannot slip in", () => {
    assert.match(encode("time", "14:30:00") as string, /CONVERT\(time, N'14:30:00', 108\)/);
    assert.throws(() => encode("time", "2026-09-07 14:30"), SqlEditError);
});

void test("a GUID is validated and brace-tolerant", () => {
    const value = "{0f8fad5b-d9cb-469f-a165-70867728950e}";
    assert.match(
        encode("uniqueidentifier", value) as string,
        /0f8fad5b-d9cb-469f-a165-70867728950e/,
    );
    assert.throws(() => encode("uniqueidentifier", "not-a-guid"), SqlEditError);
});

void test("binary takes hex with or without the prefix, and rejects odd digits", () => {
    assert.equal(encode("varbinary", "0x00FF"), "0x00ff");
    assert.equal(encode("varbinary", "00FF"), "0x00ff");
    assert.throws(() => encode("varbinary", "0xF"), SqlEditError);
    assert.throws(() => encode("varbinary", "zz"), SqlEditError);
});

void test("text length is checked in characters, allowing for Unicode storage", () => {
    // max_length is bytes; an nvarchar(10) reports 20.
    assert.doesNotThrow(() => encode("nvarchar", "0123456789", { maxLength: 20 }));
    assert.throws(() => encode("nvarchar", "01234567890", { maxLength: 20 }), SqlEditError);
    assert.doesNotThrow(() => encode("varchar", "0123456789", { maxLength: 10 }));
});

void test("a max-length column is not length checked", () => {
    assert.doesNotThrow(() => encode("nvarchar", "x".repeat(10000), { maxLength: -1 }));
});

void test("spatial values carry their SRID rather than defaulting silently", () => {
    // A geography comparison across different SRIDs returns null instead of failing, so an
    // unstated SRID is a silent bug.
    assert.match(
        encode("geography", "POINT(-122.35 47.62)") as string,
        /geography::STGeomFromText\(N'POINT\(-122\.35 47\.62\)', 4326\)/,
    );
    assert.match(
        encode("geometry", "SRID=3857;POINT(0 0)") as string,
        /geometry::STGeomFromText\(N'POINT\(0 0\)', 3857\)/,
    );
});

void test("hierarchyid is written from its path form", () => {
    assert.match(encode("hierarchyid", "/1/3/") as string, /CONVERT\(hierarchyid, N'\/1\/3\/'\)/);
});

void test("a vector takes an array of numbers, and its cast carries the dimension", () => {
    // max_length 16 is an 8-byte header plus two 4-byte dimensions.
    assert.match(
        encode("vector", "[0.1, 0.2]", { maxLength: 16 }) as string,
        /CONVERT\(vector\(2\), N'\[0\.1, 0\.2\]'\)/,
    );
    assert.throws(() => encode("vector", '["a"]', { maxLength: 12 }), SqlEditError);
    assert.throws(() => encode("vector", "0.1, 0.2", { maxLength: 16 }), SqlEditError);
});

void test("rowversion can never be written", () => {
    assert.equal(isWritableType("rowversion"), false);
    assert.equal(isWritableType("timestamp"), false);
    assert.throws(() => encode("rowversion", "0x01"), SqlEditError);
});

void test("null is only accepted where the column allows it", () => {
    assert.equal(encode("int", null, { isNullable: true }), "NULL");
    assert.throws(() => encode("int", null, { isNullable: false }), SqlEditError);
});

void test("a type the engine does not model is refused, never guessed at", () => {
    // Guessing a representation would corrupt the column rather than fail.
    assert.throws(() => encode("some_udt", "value"), SqlEditError);
});
