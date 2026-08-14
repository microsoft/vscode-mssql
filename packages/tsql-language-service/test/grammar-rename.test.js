/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL RENAME OBJECT grammar", () => {
    // Verifies simple, multipart, delimited, and optional :: source object forms.
    test("parses supported RENAME OBJECT forms", () => {
        const snapshot = parse(`
RENAME OBJECT T2 TO T1;
RENAME OBJECT dbo.T2 TO T1;
RENAME OBJECT mydb.dbo.T2 TO T1;
RENAME OBJECT :: dbo.[T1] TO T2;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/RenameObjectStatement\(/g) ?? []).length, 4);
    });

    // Verifies the destination is one new object name rather than a multipart target.
    test("reports a multipart destination name", () => {
        assert.ok(parse("RENAME OBJECT dbo.T2 TO dbo.T1;").diagnostics.length > 0);
    });

    // Verifies a source object is required after the optional :: marker.
    test("reports a missing source object", () => {
        assert.ok(parse("RENAME OBJECT :: TO T1;").diagnostics.length > 0);
    });
});

function parse(sql) {
    return new LezerSyntaxService().parse(new ImmutableTextSnapshot("file:///rename.sql", 1, sql));
}
