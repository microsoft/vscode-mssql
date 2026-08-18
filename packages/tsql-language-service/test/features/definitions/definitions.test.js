/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CachedObjectDefinitionProvider,
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InMemoryObjectDefinitionProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullObjectDefinitionProvider,
    TsqlLanguageFeatureService,
    objectDefinitionKey,
} = require("../../../dist/index.js");

const uri = "file:///definitions.sql";

function catalog() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo", caseSensitive: false },
        databases: [{ name: "db" }, { name: "archive" }],
        schemas: [
            { database: "db", name: "dbo" },
            { database: "archive", name: "history" },
        ],
        objects: [
            {
                ref: { id: "customers", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
            {
                ref: { id: "active", database: "db" },
                database: "db",
                schema: "dbo",
                name: "ActiveCustomers",
                kind: "view",
            },
            {
                ref: { id: "orders", database: "archive" },
                database: "archive",
                schema: "history",
                name: "Orders2024",
                kind: "table",
            },
            {
                ref: { id: "code", database: "db" },
                database: "db",
                schema: "dbo",
                name: "OrderCode",
                kind: "type",
                typeCategory: "alias",
            },
        ],
    });
}

async function open(sql, metadata = catalog()) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    await runtime.open(uri, 1, sql);
    return new TsqlLanguageFeatureService(runtime, metadata);
}

suite("definition targets", () => {
    test("resolves a declaration inside the document without naming an object", async () => {
        const sql = "DECLARE @id int; SELECT @id;";
        const features = await open(sql);
        const target = features.definitionTarget(uri, 1, sql.indexOf("@id;"));
        assert.equal(target.object, undefined);
        assert.deepEqual(target.locations, [
            { uri, range: { start: sql.indexOf("@id"), end: sql.indexOf("@id") + 3 } },
        ]);
        assert.deepEqual(features.definition(uri, 1, sql.indexOf("@id;")), target.locations);
    });

    test("names the catalog object behind a rowset reference", async () => {
        const sql = "SELECT 1 FROM dbo.Customers;";
        const features = await open(sql);
        const target = features.definitionTarget(uri, 1, sql.indexOf("Customers"));
        assert.deepEqual(target.locations, []);
        assert.deepEqual(target.object, {
            database: "db",
            schema: "dbo",
            name: "Customers",
            kind: "table",
        });
    });

    test("carries the database of a cross-database object", async () => {
        const sql = "SELECT 1 FROM archive.history.Orders2024;";
        const features = await open(sql);
        const target = features.definitionTarget(uri, 1, sql.indexOf("Orders2024"));
        assert.deepEqual(target.object, {
            database: "archive",
            schema: "history",
            name: "Orders2024",
            kind: "table",
        });
    });

    // The binder resolves rowsets and routines, not the type names a declaration mentions, so a
    // user-defined type is not navigable yet. The descriptor already carries `typeCategory` for
    // when it becomes one.
    test("names nothing for a type reference the binder does not resolve", async () => {
        const sql = "DECLARE @v dbo.OrderCode;";
        const features = await open(sql);
        assert.deepEqual(features.definitionTarget(uri, 1, sql.indexOf("OrderCode")), {
            locations: [],
        });
    });

    test("names nothing for an unresolved object or an empty position", async () => {
        const sql = "SELECT 1 FROM dbo.Missing;";
        const features = await open(sql);
        assert.deepEqual(features.definitionTarget(uri, 1, sql.indexOf("Missing")), {
            locations: [],
        });
        assert.deepEqual(features.definitionTarget(uri, 1, 0), { locations: [] });
    });

    test("rejects a stale document version", async () => {
        const features = await open("SELECT 1;");
        assert.throws(() => features.definitionTarget(uri, 2, 0), /Stale document request/u);
    });
});

suite("object definition providers", () => {
    const descriptor = { database: "db", schema: "dbo", name: "Customers", kind: "table" };
    const request = { ...descriptor, connectionId: "connection-a", metadataGeneration: 1 };

    test("the offline provider answers nothing", async () => {
        assert.equal(await new NullObjectDefinitionProvider().getDefinition(request), undefined);
    });

    test("the in-memory provider matches on identity, ignoring case", async () => {
        const provider = new InMemoryObjectDefinitionProvider([[descriptor, "CREATE TABLE ..."]]);
        assert.deepEqual(await provider.getDefinition(request), { text: "CREATE TABLE ..." });
        assert.deepEqual(
            await provider.getDefinition({ ...request, name: "CUSTOMERS", schema: "DBO" }),
            { text: "CREATE TABLE ..." },
        );
        assert.equal(await provider.getDefinition({ ...request, name: "Orders" }), undefined);
    });

    test("identity keys separate objects that differ in any component", () => {
        const keys = new Set([
            objectDefinitionKey(descriptor),
            objectDefinitionKey({ ...descriptor, database: "archive" }),
            objectDefinitionKey({ ...descriptor, schema: "history" }),
            objectDefinitionKey({ ...descriptor, name: "Orders" }),
            objectDefinitionKey({ ...descriptor, kind: "view" }),
            objectDefinitionKey({ ...descriptor, typeCategory: "table" }),
        ]);
        assert.equal(keys.size, 6);
        assert.equal(
            objectDefinitionKey(descriptor),
            objectDefinitionKey({ ...descriptor, name: "CUSTOMERS" }),
        );
        assert.notEqual(
            objectDefinitionKey({ ...descriptor, schema: "a b", name: "c" }),
            objectDefinitionKey({ ...descriptor, schema: "a", name: "b c" }),
        );
    });

    test("the cache fetches an object once per metadata generation", async () => {
        let fetches = 0;
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition() {
                fetches++;
                return { text: `script ${fetches}` };
            },
        });

        assert.deepEqual(await cached.getDefinition(request), { text: "script 1" });
        assert.deepEqual(await cached.getDefinition(request), { text: "script 1" });
        assert.equal(fetches, 1);

        assert.deepEqual(await cached.getDefinition({ ...request, metadataGeneration: 2 }), {
            text: "script 2",
        });
        assert.equal(fetches, 2);
    });

    test("the cache keeps connections apart and can drop one", async () => {
        let fetches = 0;
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition(current) {
                fetches++;
                return { text: current.connectionId };
            },
        });

        await cached.getDefinition(request);
        await cached.getDefinition({ ...request, connectionId: "connection-b" });
        assert.equal(fetches, 2);
        assert.equal(cached.size, 2);

        cached.invalidate("connection-a");
        assert.equal(cached.size, 1);
        await cached.getDefinition({ ...request, connectionId: "connection-b" });
        assert.equal(fetches, 2);
        await cached.getDefinition(request);
        assert.equal(fetches, 3);

        cached.invalidate();
        assert.equal(cached.size, 0);
    });

    test("concurrent requests for one object share a single fetch", async () => {
        let fetches = 0;
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition() {
                fetches++;
                await new Promise((resolve) => setTimeout(resolve, 5));
                return { text: "script" };
            },
        });

        const results = await Promise.all([
            cached.getDefinition(request),
            cached.getDefinition(request),
            cached.getDefinition(request),
        ]);
        assert.deepEqual(results, [{ text: "script" }, { text: "script" }, { text: "script" }]);
        assert.equal(fetches, 1);
    });

    test("a failure is not remembered", async () => {
        let attempts = 0;
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition() {
                attempts++;
                if (attempts === 1) throw new Error("permission denied");
                return { text: "script" };
            },
        });

        await assert.rejects(() => cached.getDefinition(request), /permission denied/u);
        assert.equal(cached.size, 0);
        assert.deepEqual(await cached.getDefinition(request), { text: "script" });
        assert.equal(attempts, 2);
    });

    test("the cache drops the least recently used entry over its budget", async () => {
        const cached = new CachedObjectDefinitionProvider(
            {
                async getDefinition(current) {
                    return { text: current.name };
                },
            },
            { maxEntries: 2 },
        );

        await cached.getDefinition({ ...request, name: "One" });
        await cached.getDefinition({ ...request, name: "Two" });
        await cached.getDefinition({ ...request, name: "One" });
        await cached.getDefinition({ ...request, name: "Three" });

        assert.equal(cached.size, 2);
        cached.invalidate();
        assert.equal(cached.size, 0);
    });
});
