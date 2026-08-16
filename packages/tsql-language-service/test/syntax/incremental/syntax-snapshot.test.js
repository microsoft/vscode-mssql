/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} = require("../../../dist/index.js");

suite("incremental syntax snapshots", () => {
    // A localized edit must use Lezer's incremental path and retain the final document version.
    test("uses Lezer fragments for a single incremental edit", () => {
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

    // The retained CST is structural: ordinary whitespace and token wrappers stay out of the tree.
    test("keeps a compact tree without per-token Item or whitespace nodes", () => {
        const service = new LezerSyntaxService();
        const snapshot = service.parse(
            new ImmutableTextSnapshot("file:///compact.sql", 1, "SELECT 1; -- comment"),
        );
        const tree = snapshot.tree.toString();
        assert.equal(tree.includes("Item("), false);
        assert.equal(tree.includes("Whitespace"), false);
        assert.match(tree, /^Script\(Batch\(Statement\(SelectStatement/);
        assert.match(tree, /LineComment/);
    });

    // Sequential edits must transform the same fragments and match a fresh parse of final text.
    test("transforms reusable fragments through sequential edit batches", () => {
        const service = new LezerSyntaxService();
        const firstText = new ImmutableTextSnapshot(
            "file:///multi.sql",
            1,
            "SELECT alpha;\nSELECT beta;",
        );
        const first = service.parse(firstText);
        const firstChange = { start: 7, end: 12, text: "x" };
        const intermediate = applyTextChanges(firstText, 2, [firstChange]);
        const beta = intermediate.text.indexOf("beta");
        const secondChange = { start: beta, end: beta + 4, text: "gamma" };
        const finalText = applyTextChanges(intermediate, 3, [secondChange]);
        const incremental = service.update(first, finalText, [firstChange, secondChange]);
        const fresh = service.parse(finalText);

        assert.equal(incremental.statistics.mode, "incremental");
        assert.deepEqual(treeShape(incremental), treeShape(fresh));
    });
});

function treeShape(snapshot) {
    const nodes = [];
    const cursor = snapshot.tree.cursor();
    do nodes.push([cursor.name, cursor.from, cursor.to]);
    while (cursor.next());
    return nodes;
}
