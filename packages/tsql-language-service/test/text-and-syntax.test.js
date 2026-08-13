/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    ImmutableTextSnapshot,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    applyTextChanges,
} = require("../dist/index.js");

describe("text and syntax scaffolding", () => {
    it("applies sequential UTF-16 edits and converts positions", () => {
        const first = new ImmutableTextSnapshot("file:///a.sql", 1, "SELECT 😀\r\nFROM t");
        assert.deepEqual(first.positionAt(9), { line: 0, character: 9 });
        const second = applyTextChanges(first, 2, [{ start: 0, end: 6, text: "select" }]);
        assert.equal(second.text, "select 😀\r\nFROM t");
        assert.equal(second.offsetAt({ line: 1, character: 4 }), 15);
    });

    it("uses Lezer fragments for a single incremental edit", () => {
        const service = new LezerSyntaxService();
        const firstText = new ImmutableTextSnapshot("file:///a.sql", 1, "SELECT 1;\nSELECT 2;");
        const first = service.parse(firstText);
        const change = { start: 7, end: 8, text: "3" };
        const secondText = applyTextChanges(firstText, 2, [change]);
        const second = service.update(first, secondText, [change]);
        assert.equal(second.statistics.mode, "incremental");
        assert.equal(second.document.text, "SELECT 3;\nSELECT 2;");
        assert.ok(second.statistics.reusableFragmentCount >= 0);
    });

    it("publishes detailed stats without triggering additional work", async () => {
        const runtime = new InProcessLanguageServiceRuntime();
        await runtime.open("file:///stats.sql", 1, "SELECT 1;");
        const stats = runtime.getStats("file:///stats.sql");
        assert.equal(stats.document.version, 1);
        assert.equal(stats.runtime.mode, "in-process");
        assert.equal(stats.metadata.providerId, "null");
    });
});
