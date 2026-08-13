/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    DevQueryMetadataAdapter,
    InMemoryMetadataProvider,
    NullMetadataProvider,
    SimpleQueryMetadataAdapter,
} = require("../dist/index.js");

function assertProviderContract(provider) {
    const first = provider.pin();
    assert.equal(first.providerId, provider.id);
    assert.equal(provider.pin(), first, "pin is stable until publication");
    const resolution = first.resolveObject(["dbo", "missing"]);
    assert.ok(["notFound", "unknown"].includes(resolution.kind));
    assert.ok(Array.isArray(first.searchObjects({ prefix: "", limit: 10 })));
}

describe("metadata provider contracts", () => {
    it("supports null and in-memory views", () => {
        assertProviderContract(new NullMetadataProvider());
        assertProviderContract(
            new InMemoryMetadataProvider({
                objects: [{ ref: { id: "1" }, schema: "dbo", name: "Users", kind: "table" }],
                schemas: [{ name: "dbo" }],
            }),
        );
    });

    it("adapts dev/query without importing its implementation", () => {
        const inner = new NullMetadataProvider();
        const adapter = new DevQueryMetadataAdapter({
            pin: () => inner.pin(),
            requestHydration: () => undefined,
            refresh: (signal) => inner.refresh(signal),
            subscribe: (listener) => inner.onDidChange(listener),
        });
        assertProviderContract(adapter);
    });

    it("coalesces simple-query refresh and publishes one generation", async () => {
        let calls = 0;
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                load: async () => {
                    calls++;
                    await Promise.resolve();
                    return { objects: [], schemas: [], databases: [] };
                },
            },
        );
        const [first, second] = await Promise.all([adapter.refresh(), adapter.refresh()]);
        assert.equal(calls, 1);
        assert.equal(first.generation, second.generation);
        assert.equal(adapter.pin().providerId, "simple-query");
    });
});
