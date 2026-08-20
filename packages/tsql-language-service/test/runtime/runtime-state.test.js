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
        assert.equal(stats.metadata.observationState, "unavailable");
    });
    // Empty observation arrays mean zero only when an observer actually collected the operation.
    // Offline metadata and an unwired observer are distinct states in exported diagnostics.
    test("distinguishes unavailable, uncollected, and collected metadata observations", async () => {
        const unobservedMetadata = new InMemoryMetadataProvider();
        const unobserved = new InProcessLanguageServiceRuntime(
            undefined,
            undefined,
            unobservedMetadata,
        );
        await unobserved.open("file:///unobserved.sql", 1, "SELECT 1;");
        assert.equal(
            unobserved.getStats("file:///unobserved.sql").metadata.observationState,
            "notCollected",
        );

        const observedMetadata = {
            id: "observed",
            pin: () => unobservedMetadata.pin(),
            requestHydration: (request) => unobservedMetadata.requestHydration(request),
            refresh: (signal) => unobservedMetadata.refresh(signal),
            onDidChange: (listener) => unobservedMetadata.onDidChange(listener),
            catalogStats: () => ({
                fetches: [],
                scopes: [],
                observedFetches: 0,
                invalidations: [],
                inFlight: 0,
            }),
        };
        const observed = new InProcessLanguageServiceRuntime(
            undefined,
            undefined,
            observedMetadata,
        );
        await observed.open("file:///observed.sql", 1, "SELECT 1;");
        const metadata = observed.getStats("file:///observed.sql").metadata;
        assert.equal(metadata.observationState, "collected");
        assert.equal(metadata.observedFetches, 0);
    });
    // Statistics describe the immutable metadata view used by binding. Publishing stats must not
    // pin a newer generation and attribute it to semantic results built from an older one.
    test("reports the metadata generation pinned for the analysis snapshot", async () => {
        const inner = new InMemoryMetadataProvider({ completeness: { objects: "ready" } });
        let pins = 0;
        const metadata = {
            id: "counting",
            pin() {
                pins++;
                return inner.pin();
            },
            requestHydration: (request) => inner.requestHydration(request),
            refresh: (signal) => inner.refresh(signal),
            onDidChange: (listener) => inner.onDidChange(listener),
        };
        const runtime = new InProcessLanguageServiceRuntime(undefined, undefined, metadata);
        const snapshot = await runtime.open("file:///metadata-generation.sql", 1, "SELECT 1;");
        const stats = runtime.getStats("file:///metadata-generation.sql");

        assert.equal(pins, 1);
        assert.equal(snapshot.metadata.generation, snapshot.semantics.metadataGeneration);
        assert.equal(stats.metadata.generation, snapshot.metadata.generation);
        assert.deepEqual(stats.metadata.completeness, snapshot.metadata.completeness);
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
