/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { sqlLiteral } from "../../src/dashboard/data/sqlLiteral";

suite("SQL Dashboard SQL literals", () => {
    test("escapes nvarchar and identifiers without changing their value", () => {
        expect(sqlLiteral.nvarchar("O'Brien")).to.equal("N'O''Brien'");
        expect(sqlLiteral.ident("odd]name")).to.equal("[odd]]name]");
    });

    test("accepts only bounded numeric literals", () => {
        expect(sqlLiteral.int(2_147_483_647)).to.equal("2147483647");
        expect(sqlLiteral.bigint("9223372036854775807")).to.equal("9223372036854775807");
        expect(() => sqlLiteral.int(1.5)).to.throw(RangeError);
        expect(() => sqlLiteral.bigint("1; DROP TABLE t")).to.throw(TypeError);
        expect(() => sqlLiteral.bigint("9223372036854775808")).to.throw(RangeError);
    });

    test("requires canonical GUIDs and UTC datetimes", () => {
        expect(sqlLiteral.guid("9dc4898d-4abe-4e42-8702-fb68931d10c8")).to.equal(
            "CONVERT(uniqueidentifier, '9dc4898d-4abe-4e42-8702-fb68931d10c8')",
        );
        expect(sqlLiteral.datetime2Utc("2026-08-14T23:52:35Z")).to.equal(
            "CONVERT(datetime2(7), N'2026-08-14T23:52:35.000Z', 127)",
        );
        expect(() => sqlLiteral.guid("not-a-guid")).to.throw(TypeError);
        expect(() => sqlLiteral.datetime2Utc("2026-08-14T23:52:35")).to.throw(TypeError);
    });

    test("rejects NUL in textual values", () => {
        expect(() => sqlLiteral.nvarchar("a\0b")).to.throw(TypeError);
        expect(() => sqlLiteral.ident("a\0b")).to.throw(TypeError);
    });
});
