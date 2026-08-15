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
    assert.ok(
        ["loaded", "notLoaded", "loading", "failed"].includes(
            first.columnState({ id: "missing" }).kind,
        ),
    );
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

    it("resolves known objects but not missing objects in a partial generation", () => {
        const provider = new InMemoryMetadataProvider({
            completeness: { objects: "partial", columns: "partial", parameters: "partial" },
            objects: [{ ref: { id: "1" }, schema: "dbo", name: "Users", kind: "table" }],
        });
        const view = provider.pin();
        assert.equal(view.resolveObject(["dbo", "Users"]).kind, "resolved");
        assert.equal(view.resolveObject(["dbo", "Missing"]).kind, "unknown");
        assert.equal(view.columnState({ id: "1" }).kind, "notLoaded");
        assert.equal(view.parameterState({ id: "1" }).kind, "notLoaded");
    });

    it("tracks lazy catalog readiness independently for each database", () => {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "PrimaryDb" },
            completeness: { schemas: "ready", objects: "ready" },
            databases: [{ name: "PrimaryDb" }, { name: "ArchiveDb" }],
            schemas: [{ database: "PrimaryDb", name: "dbo" }],
            databaseCatalogCompleteness: new Map([
                ["PrimaryDb", { schemas: "ready", objects: "ready" }],
                ["ArchiveDb", { schemas: "unknown", objects: "unknown" }],
            ]),
        });

        assert.equal(provider.pin().schemas("ArchiveDb"), undefined);
        assert.equal(
            provider.pin().databaseCatalogCompleteness("ArchiveDb").objects,
            "unknown",
        );
        provider.merge({
            schemas: [{ database: "ArchiveDb", name: "history" }],
            objects: [
                {
                    ref: { id: "archive:1", database: "ArchiveDb" },
                    database: "ArchiveDb",
                    schema: "history",
                    name: "Orders",
                    kind: "table",
                },
            ],
            databaseCatalogCompleteness: new Map([
                ["ArchiveDb", { schemas: "ready", objects: "ready" }],
            ]),
        });

        assert.deepEqual(provider.pin().schemas("ArchiveDb").map((schema) => schema.name), [
            "history",
        ]);
        assert.equal(
            provider.pin().resolveObject(["ArchiveDb", "history", "Orders"]).kind,
            "resolved",
        );
        assert.equal(provider.pin().schemas("PrimaryDb").length, 1);
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
                refresh: async (_executor, publisher) => {
                    calls++;
                    await Promise.resolve();
                    publisher.replace({ objects: [], schemas: [], databases: [] });
                },
                hydrate: async () => undefined,
            },
        );
        const [first, second] = await Promise.all([adapter.refresh(), adapter.refresh()]);
        assert.equal(calls, 1);
        assert.equal(first.generation, second.generation);
        assert.equal(adapter.pin().providerId, "simple-query");
    });

    it("coalesces per-object hydration and publishes explicit load states", async () => {
        let hydrateCalls = 0;
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                refresh: async (_executor, publisher) =>
                    publisher.replace({
                        completeness: { objects: "ready", columns: "partial" },
                        objects: [
                            { ref: { id: "7" }, schema: "dbo", name: "Users", kind: "table" },
                        ],
                    }),
                hydrate: async (_executor, request, publisher) => {
                    hydrateCalls++;
                    await gate;
                    const value = [{ name: "Id", typeDisplay: "int" }];
                    publisher.merge({
                        columnStates: new Map([[request.object.id, { kind: "loaded", value }]]),
                    });
                },
            },
        );
        await adapter.refresh();
        const request = { section: "columns", object: { id: "7" }, priority: "interactive" };
        adapter.requestHydration(request);
        adapter.requestHydration(request);
        assert.equal(adapter.pin().columnState({ id: "7" }).kind, "loading");
        const settled = adapter.waitForHydration();
        release();
        await settled;
        assert.equal(hydrateCalls, 1);
        assert.deepEqual(adapter.pin().columnState({ id: "7" }), {
            kind: "loaded",
            value: [{ name: "Id", typeDisplay: "int" }],
        });
    });

    it("coalesces lazy cross-database schema hydration", async () => {
        let hydrateCalls = 0;
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                refresh: async (_executor, publisher) =>
                    publisher.replace({
                        environment: { currentDatabase: "PrimaryDb" },
                        databases: [{ name: "PrimaryDb" }, { name: "ArchiveDb" }],
                        databaseCatalogCompleteness: new Map([
                            ["PrimaryDb", { schemas: "ready", objects: "ready" }],
                            ["ArchiveDb", { schemas: "unknown", objects: "unknown" }],
                        ]),
                    }),
                hydrate: async (_executor, request, publisher) => {
                    hydrateCalls++;
                    publisher.merge({
                        schemas: [{ database: request.database, name: "history" }],
                        databaseCatalogCompleteness: new Map([
                            [request.database, { schemas: "ready" }],
                        ]),
                    });
                },
            },
        );
        await adapter.refresh();
        const request = {
            section: "schemas",
            database: "archivedb",
            priority: "interactive",
        };
        adapter.requestHydration(request);
        adapter.requestHydration(request);
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(hydrateCalls, 1);
        assert.deepEqual(adapter.pin().schemas("ArchiveDb").map((schema) => schema.name), [
            "history",
        ]);
    });

    it("keeps the prior catalog usable when a refresh fails", async () => {
        let fail = false;
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                refresh: async (_executor, publisher) => {
                    publisher.merge({ completeness: { objects: "loading" } });
                    if (fail) throw new Error("refresh failed");
                    publisher.replace({
                        completeness: { objects: "ready" },
                        objects: [
                            { ref: { id: "9" }, schema: "dbo", name: "Orders", kind: "table" },
                        ],
                    });
                },
                hydrate: async () => undefined,
            },
        );
        await adapter.refresh();
        fail = true;
        await assert.rejects(adapter.refresh(), /refresh failed/);
        const view = adapter.pin();
        assert.equal(view.completeness.objects, "stale");
        assert.equal(view.resolveObject(["dbo", "Orders"]).kind, "resolved");
        assert.equal(view.resolveObject(["dbo", "Missing"]).kind, "unknown");
    });

    it("forces and coalesces an authoritative principal-only refresh", async () => {
        let hydrateCalls = 0;
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                refresh: async (_executor, publisher) =>
                    publisher.replace({
                        completeness: { objects: "ready", principals: "ready" },
                        objects: [
                            { ref: { id: "7" }, schema: "dbo", name: "Users", kind: "table" },
                        ],
                        principals: [{ id: "old", name: "OldLogin", kind: "login" }],
                    }),
                hydrate: async (_executor, request, publisher) => {
                    assert.equal(request.section, "principals");
                    hydrateCalls++;
                    await gate;
                    publisher.replaceSection("principals", {
                        completeness: { principals: "ready" },
                        principals: [{ id: "new", name: "NewLogin", kind: "login" }],
                    });
                },
            },
        );
        await adapter.refresh();

        const first = adapter.refreshSections(["principals"]);
        const second = adapter.refreshSections(["principals"]);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(adapter.pin().completeness.principals, "loading");
        release();
        const [firstResult, secondResult] = await Promise.all([first, second]);

        assert.equal(hydrateCalls, 1);
        assert.equal(firstResult.generation, secondResult.generation);
        assert.deepEqual(
            adapter.pin().searchPrincipals({ prefix: "" }).map((principal) => principal.name),
            ["NewLogin"],
        );
        assert.equal(adapter.pin().resolveObject(["dbo", "Users"]).kind, "resolved");
    });
});
