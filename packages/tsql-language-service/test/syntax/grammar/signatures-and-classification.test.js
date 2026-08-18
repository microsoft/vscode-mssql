/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");

const { assertValid, parse } = createSyntaxHarness("signatures-and-classification.sql");

suite("T-SQL signatures and sensitivity classifications", () => {
    // Module signatures accept ordinary and counter signatures plus every cryptographic source.
    test("parses module signature statements", () => {
        assertValid("ADD SIGNATURE TO dbo.p1 BY CERTIFICATE cert1");
        assertValid(
            "ADD COUNTER SIGNATURE TO ASSEMBLY::a1 BY ASYMMETRIC KEY k1 WITH PASSWORD = 'p'",
        );
        assertValid(
            "DROP COUNTER SIGNATURE FROM OBJECT::dbo.p1 BY CERTIFICATE c1 WITH SIGNATURE = 0x10",
        );
        assertValid(
            "ADD SIGNATURE TO DATABASE::db1 BY PASSWORD = 'p', CERTIFICATE c1, ASYMMETRIC KEY k1",
        );
    });

    // Classification targets require table-qualified columns and ADD requires at least one option.
    test("parses sensitivity classification statements", () => {
        assertValid(
            "ADD SENSITIVITY CLASSIFICATION TO t1.c1, dbo.t1.c2 WITH (LABEL = 'private', RANK = HIGH)",
        );
        assertValid("DROP SENSITIVITY CLASSIFICATION FROM t1.c1, dbo.t1.c2");
    });

    // Missing structural clauses remain visible as recovery instead of becoming phantom statements.
    test("rejects incomplete signature and classification statements", () => {
        for (const sql of [
            "ADD SIGNATURE dbo.p1 BY CERTIFICATE c1",
            "DROP SIGNATURE FROM dbo.p1",
            "ADD SENSITIVITY CLASSIFICATION TO c1 WITH (LABEL = 'private')",
            "ADD SENSITIVITY CLASSIFICATION TO t1.c1 WITH ()",
            "DROP SENSITIVITY CLASSIFICATION t1.c1",
        ]) {
            assert.ok(parse(sql).statistics.rawErrorNodeCount > 0, sql);
        }
    });

    // A damaged signature must not consume the next client batch.
    test("bounds signature recovery to one batch", () => {
        const snapshot = parse("ADD SIGNATURE TO dbo.p1 BY\nGO\nSELECT 1;");
        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
