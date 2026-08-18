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
            {
                ref: { id: "rate", database: "db" },
                database: "db",
                schema: "dbo",
                name: "fn_Rate",
                kind: "scalarFunction",
            },
            {
                ref: { id: "refresh", database: "db" },
                database: "db",
                schema: "dbo",
                name: "usp_Refresh",
                kind: "procedure",
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

    test("carries the category that distinguishes user type kinds", async () => {
        const sql = "DECLARE @v dbo.OrderCode;";
        const features = await open(sql);
        assert.deepEqual(features.definitionTarget(uri, 1, sql.indexOf("OrderCode")).object, {
            database: "db",
            schema: "dbo",
            name: "OrderCode",
            kind: "type",
            typeCategory: "alias",
        });
    });

    test("names the routine behind a call and the module behind an EXEC", async () => {
        const call = "SELECT dbo.fn_Rate(1);";
        assert.equal(
            (await open(call)).definitionTarget(uri, 1, call.indexOf("fn_Rate")).object?.name,
            "fn_Rate",
        );
        const execute = "EXEC dbo.usp_Refresh;";
        assert.equal(
            (await open(execute)).definitionTarget(uri, 1, execute.indexOf("usp_Refresh")).object
                ?.name,
            "usp_Refresh",
        );
    });

    test("names the object a DDL statement acts on", async () => {
        for (const sql of [
            "ALTER TABLE dbo.Customers ADD b int;",
            "DROP TABLE dbo.Customers;",
            "TRUNCATE TABLE dbo.Customers;",
            "CREATE INDEX ix ON dbo.Customers (Id);",
            "GRANT SELECT ON dbo.Customers TO reader;",
        ]) {
            const features = await open(sql);
            const target = features.definitionTarget(uri, 1, sql.indexOf("Customers") + 1);
            assert.equal(target.object?.name, "Customers", sql);
        }
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

    test("nothing found is not remembered, so a later request looks again", async () => {
        let attempts = 0;
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition() {
                attempts++;
                return attempts === 1 ? undefined : { text: "script" };
            },
        });

        assert.equal(await cached.getDefinition(request), undefined);
        assert.equal(cached.size, 0);
        assert.deepEqual(await cached.getDefinition(request), { text: "script" });
        assert.equal(attempts, 2);
    });

    test("one caller giving up leaves the fetch running for the others", async () => {
        let fetches = 0;
        let release = () => {};
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition() {
                fetches++;
                await new Promise((resolve) => {
                    release = resolve;
                });
                return { text: "script" };
            },
        });

        const abandoned = new AbortController();
        const giving_up = cached.getDefinition(request, abandoned.signal);
        const waiting = cached.getDefinition(request);
        abandoned.abort();

        await assert.rejects(() => giving_up, /cancelled/u);
        release();
        assert.deepEqual(await waiting, { text: "script" });
        assert.equal(fetches, 1);
    });

    test("the shared fetch is cancelled after every caller gives up", async () => {
        let innerSignal;
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition(_request, signal) {
                innerSignal = signal;
                await new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                        { once: true },
                    );
                });
            },
        });
        const first = new AbortController();
        const second = new AbortController();
        const firstRequest = cached.getDefinition(request, first.signal);
        const secondRequest = cached.getDefinition(request, second.signal);

        first.abort();
        await assert.rejects(() => firstRequest, { name: "AbortError" });
        assert.equal(innerSignal.aborted, false);

        second.abort();
        await assert.rejects(() => secondRequest, { name: "AbortError" });
        assert.equal(innerSignal.aborted, true);
        assert.equal(cached.size, 0);
    });

    test("a caller that has already given up is never served", async () => {
        const cached = new CachedObjectDefinitionProvider({
            async getDefinition() {
                return { text: "script" };
            },
        });
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(() => cached.getDefinition(request, controller.signal), {
            name: "AbortError",
        });
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
