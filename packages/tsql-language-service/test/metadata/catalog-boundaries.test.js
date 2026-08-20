/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    decodeObjectTypeCategory,
    decodePrincipalKind,
    decodeSqlBit,
    decodeSqlInt32,
    decodeSqlObjectKind,
    sqlObjectTypeCodes,
} = require("../../dist/index.js");

suite("catalog boundary values", () => {
    test("decodes only registered SQL object type codes", () => {
        assert.equal(decodeSqlObjectKind("U"), "table");
        assert.equal(decodeSqlObjectKind(" pc "), "procedure");
        assert.equal(decodeSqlObjectKind("FT"), "tableFunction");
        assert.equal(decodeSqlObjectKind("unknown"), undefined);
        assert.equal(decodeSqlObjectKind(undefined), undefined);

        assert.deepEqual(sqlObjectTypeCodes(), [
            "U",
            "V",
            "P",
            "PC",
            "FN",
            "FS",
            "IF",
            "TF",
            "FT",
            "SN",
        ]);
        assert.deepEqual(sqlObjectTypeCodes("columns"), ["U", "V", "IF", "TF", "FT"]);
        assert.deepEqual(sqlObjectTypeCodes("parameters"), [
            "P",
            "PC",
            "FN",
            "FS",
            "IF",
            "TF",
            "FT",
        ]);
    });

    test("rejects unknown discriminators instead of casting them into unions", () => {
        assert.equal(decodeObjectTypeCategory("alias"), "alias");
        assert.equal(decodeObjectTypeCategory(" CLR "), "clr");
        assert.equal(decodeObjectTypeCategory("table"), "table");
        assert.equal(decodeObjectTypeCategory("future-type"), undefined);

        assert.equal(decodePrincipalKind("login"), "login");
        assert.equal(decodePrincipalKind(" DATABASErole "), "databaseRole");
        assert.equal(decodePrincipalKind("applicationRole"), "applicationRole");
        assert.equal(decodePrincipalKind("credential"), undefined);
    });

    test("keeps invalid SQL bit and integer values unknown", () => {
        assert.equal(decodeSqlBit("1"), true);
        assert.equal(decodeSqlBit(" true "), true);
        assert.equal(decodeSqlBit("0"), false);
        assert.equal(decodeSqlBit("FALSE"), false);
        assert.equal(decodeSqlBit("2"), undefined);
        assert.equal(decodeSqlBit(undefined), undefined);

        assert.equal(decodeSqlInt32("-2147483648"), -2_147_483_648);
        assert.equal(decodeSqlInt32("2147483647"), 2_147_483_647);
        assert.equal(decodeSqlInt32("1.5"), undefined);
        assert.equal(decodeSqlInt32("2147483648"), undefined);
        assert.equal(decodeSqlInt32("9007199254740993"), undefined);
        assert.equal(decodeSqlInt32("1e2"), undefined);
        assert.equal(decodeSqlInt32(""), undefined);
    });
});
