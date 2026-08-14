/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { Stack } = require("@lezer/lr");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL tokenizer performance regressions", () => {
    // Contextual tokens must inspect cheap lexical prefixes before consulting the LR state.
    test("does not call canShift for every identifier token", () => {
        const statement =
            "SELECT alpha.Id, alpha.Name FROM dbo.Users AS alpha WHERE alpha.Id > 0;\nGO\n";
        const sql = statement.repeat(250);
        const originalCanShift = Stack.prototype.canShift;
        let calls = 0;
        Stack.prototype.canShift = function (term) {
            calls++;
            return originalCanShift.call(this, term);
        };

        try {
            const snapshot = new LezerSyntaxService().parse(
                new ImmutableTextSnapshot("file:///tokenizer-performance.sql", 1, sql),
            );
            assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        } finally {
            Stack.prototype.canShift = originalCanShift;
        }

        assert.ok(calls <= 1_000, `expected bounded contextual checks, received ${calls}`);
    });
});
