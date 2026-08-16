/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    InProcessLanguageServiceRuntime,
    ScaffoldColorizationService,
    sqlColorTokenModifiers,
    sqlColorTokenTypes,
} = require("../../dist/index.js");

suite("coloring contracts", () => {
    test("publishes one stable SQL coloring legend", () => {
        assert.equal(new Set(sqlColorTokenTypes).size, sqlColorTokenTypes.length);
        assert.equal(new Set(sqlColorTokenModifiers).size, sqlColorTokenModifiers.length);
        assert.ok(sqlColorTokenTypes.includes("keyword"));
        assert.ok(sqlColorTokenTypes.includes("table"));
        assert.ok(sqlColorTokenTypes.includes("column"));
        assert.ok(sqlColorTokenTypes.includes("variable"));
        assert.ok(sqlColorTokenModifiers.includes("declaration"));
        assert.ok(sqlColorTokenModifiers.includes("write"));
    });

    test("scaffolds versioned full, range, and incremental results", async () => {
        const runtime = new InProcessLanguageServiceRuntime();
        const first = await runtime.open("file:///colors.sql", 1, "SELECT 1;");
        const service = new ScaffoldColorizationService();
        const full = service.provideDocumentColors(first);
        const range = service.provideRangeColors({ ...first, range: { start: 0, end: 6 } });
        assert.equal(full.kind, "full");
        assert.equal(full.documentVersion, 1);
        assert.deepEqual(full.tokens, []);
        assert.equal(range.kind, "full");

        const change = { start: 7, end: 8, text: "2" };
        const second = await runtime.change("file:///colors.sql", 1, 2, [change]);
        const delta = service.provideColorEdits(full, second, [change]);
        assert.equal(delta.kind, "delta");
        assert.equal(delta.previousResultId, full.resultId);
        assert.equal(delta.documentVersion, 2);
        assert.deepEqual(delta.edits, []);
    });
});
