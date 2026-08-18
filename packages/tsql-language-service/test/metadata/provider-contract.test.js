/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    createEngineCapabilities,
    DevQueryMetadataAdapter,
    InMemoryMetadataProvider,
    NullMetadataProvider,
    SimpleQueryMetadataAdapter,
} = require("../../dist/index.js");

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
    // Every provider reports per-object index, trigger, and constraint readiness the same way it
    // reports columns and parameters, and every section carries a declared completeness state.
    for (const state of [
        first.indexState({ id: "missing" }),
        first.triggerState({ id: "missing" }),
        first.foreignKeyState({ id: "missing" }),
    ]) {
        assert.ok(["loaded", "notLoaded", "loading", "failed"].includes(state.kind));
    }
    assert.ok(Array.isArray(first.searchSecurables({ prefix: "", limit: 10 })));
    const collations = first.collations();
    assert.ok(collations === undefined || Array.isArray(collations));
    assert.ok(
        ["loaded", "notLoaded", "loading", "failed"].includes(
            first.clrTypeState({ id: "missing" }).kind,
        ),
    );
    for (const section of [
        "indexes",
        "triggers",
        "constraints",
        "clrTypes",
        "securables",
        "collations",
    ]) {
        assert.ok(
            ["unknown", "loading", "ready", "partial", "stale", "failed"].includes(
                first.completeness[section],
            ),
            section,
        );
    }
}

suite("metadata provider contracts", () => {
    test("supports null and in-memory views", () => {
        assertProviderContract(new NullMetadataProvider());
        assertProviderContract(
            new InMemoryMetadataProvider({
                objects: [{ ref: { id: "1" }, schema: "dbo", name: "Users", kind: "table" }],
                schemas: [{ name: "dbo" }],
            }),
        );
    });

    // Every provider must carry the facts the engine-profile resolver reads, and must carry them
    // as absent rather than defaulted when the backend did not report them.
    test("carries engine facts through every provider", () => {
        const empty = new NullMetadataProvider().pin().environment;
        assert.equal(empty.engineEdition, undefined);
        assert.equal(empty.serverVersion, undefined);
        assert.equal(empty.compatibilityLevel, undefined);
        assert.equal(empty.serverName, undefined);
        assert.equal(
            createEngineCapabilities(empty).engineProfile,
            "unknown",
            "a provider that reports nothing must not resolve to an engine",
        );

        const reported = new InMemoryMetadataProvider({
            environment: {
                currentDatabase: "warehouse",
                engineEdition: 11,
                serverVersion: "12.0.2000.8",
                compatibilityLevel: 160,
                serverName: "ws.datawarehouse.fabric.microsoft.com",
            },
        }).pin().environment;
        const capabilities = createEngineCapabilities(reported);
        assert.equal(capabilities.engineProfile, "fabric-warehouse");
        assert.equal(capabilities.generation, "fabric-warehouse/16/160/ga");
    });

    test("reports the index set of one object without enumerating others", () => {
        const provider = new InMemoryMetadataProvider({
            completeness: { objects: "ready", indexes: "partial" },
            objects: [
                { ref: { id: "1" }, schema: "dbo", name: "Users", kind: "table" },
                { ref: { id: "2" }, schema: "dbo", name: "Orders", kind: "table" },
            ],
            indexes: new Map([["1", [{ name: "IX_Users", kind: "relational", clustered: true }]]]),
        });
        const view = provider.pin();
        assert.deepEqual(view.indexState({ id: "1" }), {
            kind: "loaded",
            value: [{ name: "IX_Users", kind: "relational", clustered: true }],
        });
        // A partial section proves nothing about an object it has not loaded.
        assert.equal(view.indexState({ id: "2" }).kind, "notLoaded");
        assert.equal(provider.pin().indexState({ id: "missing" }).kind, "notLoaded");
    });

    test("marks an object's index set loaded and empty only when the section is ready", () => {
        const ready = new InMemoryMetadataProvider({
            completeness: { indexes: "ready" },
            objects: [{ ref: { id: "1" }, schema: "dbo", name: "Users", kind: "table" }],
        });
        assert.deepEqual(ready.pin().indexState({ id: "1" }), { kind: "loaded", value: [] });
        for (const [state, kind] of [
            ["loading", "loading"],
            ["failed", "failed"],
            ["partial", "notLoaded"],
            ["stale", "notLoaded"],
            ["unknown", "notLoaded"],
        ]) {
            const provider = new InMemoryMetadataProvider({ completeness: { indexes: state } });
            assert.equal(provider.pin().indexState({ id: "1" }).kind, kind, state);
        }
    });

    test("replaces the index section without discarding unrelated sections", () => {
        const provider = new InMemoryMetadataProvider({
            completeness: { objects: "ready", columns: "ready", indexes: "ready" },
            objects: [{ ref: { id: "1" }, schema: "dbo", name: "Users", kind: "table" }],
            columns: new Map([["1", [{ name: "Id", typeDisplay: "int" }]]]),
            indexes: new Map([["1", [{ name: "IX_Old", kind: "relational" }]]]),
        });
        provider.replaceSection("indexes", {
            completeness: { indexes: "ready" },
            indexes: new Map([["1", [{ name: "IX_New", kind: "relational" }]]]),
        });
        const view = provider.pin();
        assert.deepEqual(
            view.indexState({ id: "1" }).value.map(({ name }) => name),
            ["IX_New"],
        );
        assert.equal(view.columnState({ id: "1" }).kind, "loaded");
        assert.equal(view.resolveObject(["dbo", "Users"]).kind, "resolved");
    });

    test("hydrates one object's index set through the simple-query adapter", async () => {
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                refresh: async (_executor, publisher) =>
                    publisher.replace({
                        completeness: { objects: "ready", indexes: "partial" },
                        objects: [
                            { ref: { id: "7" }, schema: "dbo", name: "Users", kind: "table" },
                        ],
                    }),
                hydrate: async (_executor, request, publisher) =>
                    publisher.merge({
                        indexStates: new Map([
                            [
                                request.object.id,
                                {
                                    kind: "loaded",
                                    value: [{ name: "IX_Users", kind: "relational" }],
                                },
                            ],
                        ]),
                    }),
            },
        );
        await adapter.refresh();
        assert.equal(adapter.pin().indexState({ id: "7" }).kind, "notLoaded");
        adapter.requestHydration({
            section: "indexes",
            object: { id: "7" },
            priority: "interactive",
        });
        await adapter.waitForHydration();
        assert.deepEqual(adapter.pin().indexState({ id: "7" }), {
            kind: "loaded",
            value: [{ name: "IX_Users", kind: "relational" }],
        });
    });

    test("reports trigger and foreign key sets per object", () => {
        const provider = new InMemoryMetadataProvider({
            completeness: { objects: "ready", triggers: "partial", constraints: "partial" },
            objects: [
                { ref: { id: "1" }, schema: "dbo", name: "Orders", kind: "table" },
                { ref: { id: "2" }, schema: "dbo", name: "Lines", kind: "table" },
            ],
            triggers: new Map([["1", [{ name: "tr", insteadOf: true, delete: true }]]]),
            foreignKeys: new Map([["1", [{ name: "FK", deleteAction: "cascade" }]]]),
        });
        const view = provider.pin();
        assert.deepEqual(view.triggerState({ id: "1" }), {
            kind: "loaded",
            value: [{ name: "tr", insteadOf: true, delete: true }],
        });
        assert.deepEqual(view.foreignKeyState({ id: "1" }), {
            kind: "loaded",
            value: [{ name: "FK", deleteAction: "cascade" }],
        });
        // A partial section proves nothing about an object it has not loaded.
        assert.equal(view.triggerState({ id: "2" }).kind, "notLoaded");
        assert.equal(view.foreignKeyState({ id: "2" }).kind, "notLoaded");
    });

    test("replaces the trigger and constraint sections independently", () => {
        const provider = new InMemoryMetadataProvider({
            completeness: { triggers: "ready", constraints: "ready" },
            triggers: new Map([["1", [{ name: "old" }]]]),
            foreignKeys: new Map([["1", [{ name: "FK_Old" }]]]),
        });
        provider.replaceSection("triggers", {
            completeness: { triggers: "ready" },
            triggers: new Map([["1", [{ name: "new" }]]]),
        });
        assert.deepEqual(
            provider
                .pin()
                .triggerState({ id: "1" })
                .value.map(({ name }) => name),
            ["new"],
        );
        assert.deepEqual(
            provider
                .pin()
                .foreignKeyState({ id: "1" })
                .value.map(({ name }) => name),
            ["FK_Old"],
        );
    });

    test("hydrates trigger and constraint sets through the simple-query adapter", async () => {
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                refresh: async (_executor, publisher) =>
                    publisher.replace({
                        completeness: {
                            objects: "ready",
                            triggers: "partial",
                            constraints: "partial",
                        },
                        objects: [
                            { ref: { id: "7" }, schema: "dbo", name: "Orders", kind: "table" },
                        ],
                    }),
                hydrate: async (_executor, request, publisher) =>
                    publisher.merge(
                        request.section === "triggers"
                            ? {
                                  triggerStates: new Map([
                                      [
                                          request.object.id,
                                          { kind: "loaded", value: [{ name: "tr" }] },
                                      ],
                                  ]),
                              }
                            : {
                                  foreignKeyStates: new Map([
                                      [
                                          request.object.id,
                                          { kind: "loaded", value: [{ name: "FK" }] },
                                      ],
                                  ]),
                              },
                    ),
            },
        );
        await adapter.refresh();
        assert.equal(adapter.pin().triggerState({ id: "7" }).kind, "notLoaded");
        for (const section of ["triggers", "constraints"]) {
            adapter.requestHydration({ section, object: { id: "7" }, priority: "interactive" });
        }
        await adapter.waitForHydration();
        assert.deepEqual(adapter.pin().triggerState({ id: "7" }).value, [{ name: "tr" }]);
        assert.deepEqual(adapter.pin().foreignKeyState({ id: "7" }).value, [{ name: "FK" }]);
    });

    test("scopes security objects to the server and to one database", () => {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db" },
            completeness: { securables: "ready" },
            securables: [
                { id: "1", name: "Shared", kind: "certificate" },
                { id: "2", name: "Shared", kind: "certificate", database: "db" },
                { id: "3", name: "Key", kind: "asymmetricKey", database: "db" },
            ],
        });
        const view = provider.pin();
        assert.deepEqual(
            view.searchSecurables({ kinds: ["certificate"] }).map(({ id }) => id),
            ["1"],
        );
        assert.deepEqual(
            view.searchSecurables({ database: "db", kinds: ["certificate"] }).map(({ id }) => id),
            ["2"],
        );
        assert.deepEqual(view.searchSecurables({ database: "db", kinds: ["credential"] }), []);
        assert.deepEqual(
            view.searchSecurables({ database: "db", prefix: "Ke" }).map(({ id }) => id),
            ["3"],
        );
    });

    test("reports an unavailable collation catalog as undefined", () => {
        assert.deepEqual(
            new InMemoryMetadataProvider({
                completeness: { collations: "ready" },
                collations: ["Latin1_General_CI_AS"],
            })
                .pin()
                .collations(),
            ["Latin1_General_CI_AS"],
        );
        // The section is unknown until a backend publishes it, so a provider with no collation
        // data reports unavailable rather than an empty catalog.
        assert.equal(new InMemoryMetadataProvider({}).pin().collations(), undefined);
        assert.deepEqual(
            new InMemoryMetadataProvider({ completeness: { collations: "ready" } })
                .pin()
                .collations(),
            [],
        );
        for (const state of ["unknown", "failed"]) {
            assert.equal(
                new InMemoryMetadataProvider({ completeness: { collations: state } })
                    .pin()
                    .collations(),
                undefined,
                state,
            );
        }
        assert.equal(new NullMetadataProvider().pin().collations(), undefined);
    });

    test("replaces the securable and collation sections independently", () => {
        const provider = new InMemoryMetadataProvider({
            completeness: { securables: "ready", collations: "ready" },
            securables: [{ id: "1", name: "Old", kind: "credential" }],
            collations: ["Old_CI_AS"],
        });
        provider.replaceSection("securables", {
            securables: [{ id: "2", name: "New", kind: "credential" }],
        });
        assert.deepEqual(
            provider
                .pin()
                .searchSecurables({})
                .map(({ name }) => name),
            ["New"],
        );
        assert.deepEqual(provider.pin().collations(), ["Old_CI_AS"]);
    });

    test("describes a CLR type's members only once the section publishes it", () => {
        const members = [
            { name: "X", kind: "property" },
            { name: "Parse", kind: "method", static: true },
        ];
        const provider = new InMemoryMetadataProvider({
            completeness: { clrTypes: "ready" },
            objects: [
                {
                    ref: { id: "1" },
                    schema: "dbo",
                    name: "Point",
                    kind: "type",
                    typeCategory: "clr",
                },
            ],
            clrTypes: new Map([
                ["1", { className: "Point", assemblyName: "Geo", system: false, members }],
            ]),
        });
        assert.deepEqual(provider.pin().clrTypeState({ id: "1" }), {
            kind: "loaded",
            value: { className: "Point", assemblyName: "Geo", system: false, members },
        });
        // A type the section has not published is unknown, never an empty member list.
        assert.equal(provider.pin().clrTypeState({ id: "2" }).kind, "notLoaded");
        assert.equal(
            new InMemoryMetadataProvider({}).pin().clrTypeState({ id: "1" }).kind,
            "notLoaded",
        );
        for (const [state, kind] of [
            ["loading", "loading"],
            ["failed", "failed"],
            ["partial", "notLoaded"],
            ["unknown", "notLoaded"],
        ]) {
            assert.equal(
                new InMemoryMetadataProvider({ completeness: { clrTypes: state } })
                    .pin()
                    .clrTypeState({ id: "1" }).kind,
                kind,
                state,
            );
        }
    });

    test("hydrates one CLR type through the simple-query adapter", async () => {
        const value = { className: "Point", assemblyName: "Geo", members: [] };
        const adapter = new SimpleQueryMetadataAdapter(
            { execute: async () => ({ columns: [], rows: [] }) },
            {
                refresh: async (_executor, publisher) =>
                    publisher.replace({
                        completeness: { objects: "ready" },
                        objects: [
                            {
                                ref: { id: "9" },
                                schema: "dbo",
                                name: "Point",
                                kind: "type",
                                typeCategory: "clr",
                            },
                        ],
                    }),
                hydrate: async (_executor, request, publisher) =>
                    publisher.merge({
                        clrTypeStates: new Map([[request.object.id, { kind: "loaded", value }]]),
                    }),
            },
        );
        await adapter.refresh();
        assert.equal(adapter.pin().clrTypeState({ id: "9" }).kind, "notLoaded");
        adapter.requestHydration({
            section: "clrTypes",
            object: { id: "9" },
            priority: "interactive",
        });
        await adapter.waitForHydration();
        assert.deepEqual(adapter.pin().clrTypeState({ id: "9" }), { kind: "loaded", value });
    });

    test("resolves known objects but not missing objects in a partial generation", () => {
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

    test("tracks lazy catalog readiness independently for each database", () => {
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
        assert.equal(provider.pin().databaseCatalogCompleteness("ArchiveDb").objects, "unknown");
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

        assert.deepEqual(
            provider
                .pin()
                .schemas("ArchiveDb")
                .map((schema) => schema.name),
            ["history"],
        );
        assert.equal(
            provider.pin().resolveObject(["ArchiveDb", "history", "Orders"]).kind,
            "resolved",
        );
        assert.equal(provider.pin().schemas("PrimaryDb").length, 1);
    });

    test("adapts dev/query without importing its implementation", () => {
        const inner = new NullMetadataProvider();
        const adapter = new DevQueryMetadataAdapter({
            pin: () => inner.pin(),
            requestHydration: () => undefined,
            refresh: (signal) => inner.refresh(signal),
            subscribe: (listener) => inner.onDidChange(listener),
        });
        assertProviderContract(adapter);
    });

    test("coalesces simple-query refresh and publishes one generation", async () => {
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

    test("coalesces per-object hydration and publishes explicit load states", async () => {
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

    test("coalesces lazy cross-database schema hydration", async () => {
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
        assert.deepEqual(
            adapter
                .pin()
                .schemas("ArchiveDb")
                .map((schema) => schema.name),
            ["history"],
        );
    });

    test("keeps the prior catalog usable when a refresh fails", async () => {
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

    test("forces and coalesces an authoritative principal-only refresh", async () => {
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
            adapter
                .pin()
                .searchPrincipals({ prefix: "" })
                .map((principal) => principal.name),
            ["NewLogin"],
        );
        assert.equal(adapter.pin().resolveObject(["dbo", "Users"]).kind, "resolved");
    });
});
