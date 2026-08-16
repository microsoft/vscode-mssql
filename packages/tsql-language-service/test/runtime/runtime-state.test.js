/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../../dist/index.js");

suite("language-service runtime state", () => {
    test("publishes detailed stats without triggering additional work", async () => {
        const runtime = new InProcessLanguageServiceRuntime();
        await runtime.open("file:///stats.sql", 1, "SELECT 1;");
        const stats = runtime.getStats("file:///stats.sql");
        assert.equal(stats.document.version, 1);
        assert.equal(stats.runtime.mode, "in-process");
        assert.equal(stats.metadata.providerId, "null");
    });
    test("rebinds new metadata without invoking parse or update", async () => {
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
        const metadata = new InMemoryMetadataProvider();
        const runtime = new InProcessLanguageServiceRuntime(countingSyntax, undefined, metadata);
        const first = await runtime.open("file:///rebind.sql", 1, "SELECT 1;");
        metadata.replace({ schemas: [{ name: "dbo" }] });
        const rebound = await runtime.rebind("file:///rebind.sql", 1);

        assert.equal(parserCalls, 1);
        assert.equal(rebound.syntax, first.syntax);
        assert.notEqual(rebound.semantics.metadataGeneration, first.semantics.metadataGeneration);
    });
});
