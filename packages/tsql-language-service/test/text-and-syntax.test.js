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

    it("keeps a compact tree without per-token Item or whitespace nodes", () => {
        const service = new LezerSyntaxService();
        const snapshot = service.parse(
            new ImmutableTextSnapshot("file:///compact.sql", 1, "SELECT 1; -- comment"),
        );
        const tree = snapshot.tree.toString();
        assert.equal(tree.includes("Item("), false);
        assert.equal(tree.includes("Whitespace"), false);
        assert.match(tree, /^Script\(Word,Number,Punctuation,LineComment\)$/);
    });

    it("transforms reusable fragments through sequential edit batches", () => {
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

    it("publishes detailed stats without triggering additional work", async () => {
        const runtime = new InProcessLanguageServiceRuntime();
        await runtime.open("file:///stats.sql", 1, "SELECT 1;");
        const stats = runtime.getStats("file:///stats.sql");
        assert.equal(stats.document.version, 1);
        assert.equal(stats.runtime.mode, "in-process");
        assert.equal(stats.metadata.providerId, "null");
    });

    it("rebinds new metadata without invoking parse or update", async () => {
        const syntax = new LezerSyntaxService();
        let parserCalls = 0;
        const countingSyntax = {
            parse(document) {
                parserCalls++;
                return syntax.parse(document);
            },
            update(previous, document, changes) {
                parserCalls++;
                return syntax.update(previous, document, changes);
            },
        };
        const metadata = new (require("../dist/index.js").InMemoryMetadataProvider)();
        const runtime = new InProcessLanguageServiceRuntime(countingSyntax, undefined, metadata);
        const first = await runtime.open("file:///rebind.sql", 1, "SELECT 1;");
        metadata.replace({ schemas: [{ name: "dbo" }] });
        const rebound = await runtime.rebind("file:///rebind.sql", 1);

        assert.equal(parserCalls, 1);
        assert.equal(rebound.syntax, first.syntax);
        assert.notEqual(rebound.semantics.metadataGeneration, first.semantics.metadataGeneration);
    });
});

function treeShape(snapshot) {
    const nodes = [];
    const cursor = snapshot.tree.cursor();
    do nodes.push([cursor.name, cursor.from, cursor.to]);
    while (cursor.next());
    return nodes;
}
