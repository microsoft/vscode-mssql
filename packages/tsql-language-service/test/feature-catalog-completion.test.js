/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} = require("../dist/index.js");

suite("catalog binding and completion", () => {
    // Verifies three-part cross-schema sources bind to pinned catalog identities and aliases.
    test("binds cross-schema table sources", async () => {
        const { runtime } = createServices();
        const sql = "SELECT o.Id FROM CustomerDb.sales.Orders AS o;";
        const snapshot = await runtime.open("file:///binding.sql", 1, sql);

        const symbols = snapshot.semantics.visibleSymbols(sql.indexOf("o.Id"));
        assert.ok(symbols.some((symbol) => symbol.name === "sales.Orders"));
        assert.ok(symbols.some((symbol) => symbol.name === "o" && symbol.kind === "alias"));
    });

    // Verifies schema and object candidates carry deterministic user-before-system sort keys.
    test("ranks default, dbo, user, and system catalog entries", async () => {
        const { runtime, features } = createServices();
        const schemasSql = "SELECT * FROM ";
        await runtime.open("file:///schemas.sql", 1, schemasSql);
        const schemas = features.completion("file:///schemas.sql", 1, schemasSql.length).items;
        const sort = Object.fromEntries(schemas.map((item) => [item.label, item.sortText]));
        assert.ok(sort.sales < sort.dbo);
        assert.ok(sort.dbo < sort.reporting);
        assert.ok(sort.reporting < sort.sys);
        assert.match(sort.sys, /^90-/);
        assert.match(sort.db_accessadmin, /^90-/);

        const objectsSql = "SELECT * FROM dbo.";
        await runtime.open("file:///objects.sql", 1, objectsSql);
        const objects = features.completion("file:///objects.sql", 1, objectsSql.length).items;
        assert.ok(
            objects.find((item) => item.label === "Users").sortText <
                objects.find((item) => item.label === "sysobjects").sortText,
        );

        const databaseSql = "SELECT * FROM CustomerDb.";
        await runtime.open("file:///database-schemas.sql", 1, databaseSql);
        const databaseSchemas = features.completion(
            "file:///database-schemas.sql",
            1,
            databaseSql.length,
        ).items;
        assert.ok(databaseSchemas.some((item) => item.kind === "schema" && item.label === "sales"));
    });

    // Verifies an alias-qualified incomplete projection offers the bound table's columns.
    test("completes columns through a table alias", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT u. FROM dbo.Users AS u;";
        await runtime.open("file:///columns.sql", 1, sql);
        const offset = sql.indexOf("u.") + 2;
        const result = features.completion("file:///columns.sql", 1, offset);

        assert.deepEqual(
            result.items.filter((item) => item.kind === "column").map((item) => item.label),
            ["Id", "Display Name"],
        );
    });

    // Verifies SELECT * expansion uses bound catalog columns and quotes unsafe identifiers.
    test("expands SELECT star from the bound source", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT * FROM dbo.Users;";
        await runtime.open("file:///star.sql", 1, sql);
        const result = features.completion("file:///star.sql", 1, sql.indexOf("*") + 1);
        const expansion = result.items.find((item) => item.label === "Expand SELECT *");

        assert.deepEqual(expansion.edit, {
            start: sql.indexOf("*"),
            end: sql.indexOf("*") + 1,
            newText: "[Id], [Display Name]",
        });
    });

    // Verifies smart INSERT expansion omits generated columns and replaces stray closing syntax.
    test("expands INSERT columns and values without duplicate closing brackets", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders);)";
        await runtime.open("file:///insert.sql", 1, sql);
        const offset = sql.indexOf("Orders") + "Orders".length;
        const result = features.completion("file:///insert.sql", 1, offset);
        const expansion = result.items.find(
            (item) => item.label === "Expand INSERT columns and VALUES",
        );

        assert.ok(expansion);
        assert.equal(expansion.edit.end, sql.length);
        assert.match(expansion.edit.newText, /\[CustomerId\]/);
        assert.doesNotMatch(expansion.edit.newText, /OrderId|ComputedTotal/);
        assert.match(expansion.edit.newText, /VALUES \(\n\s+NULL\n\);$/);
    });

    // Verifies prefix lookup remains interactive for the reported 50k-plus object catalog shape.
    test("completes a 60k-object dbo catalog within an interactive budget", async () => {
        const objects = Array.from({ length: 60_000 }, (_, index) => ({
            ref: { id: `large:${index}` },
            database: "CustomerDb",
            schema: "dbo",
            name: `Table${index.toString().padStart(5, "0")}`,
            kind: "table",
        }));
        const metadata = new InMemoryMetadataProvider({
            environment: { currentDatabase: "CustomerDb", defaultSchema: "dbo" },
            objects,
            schemas: [{ database: "CustomerDb", name: "dbo" }],
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const sql = "SELECT * FROM dbo.Table59999";
        await runtime.open("file:///large.sql", 1, sql);
        const started = performance.now();
        const result = features.completion("file:///large.sql", 1, sql.length);
        const elapsedMs = performance.now() - started;

        assert.ok(result.items.some((item) => item.label === "Table59999"));
        assert.ok(elapsedMs < 1_000, `catalog completion took ${elapsedMs.toFixed(1)} ms`);
    });
});

function createServices() {
    const objects = [
        object("users", "dbo", "Users", "table"),
        object("orders", "sales", "Orders", "table"),
        { ...object("sysobjects", "dbo", "sysobjects", "view"), system: true },
    ];
    const metadata = new InMemoryMetadataProvider({
        environment: {
            currentDatabase: "CustomerDb",
            defaultSchema: "sales",
            caseSensitive: false,
        },
        schemas: [
            { database: "CustomerDb", name: "sys" },
            { database: "CustomerDb", name: "reporting" },
            { database: "CustomerDb", name: "dbo" },
            { database: "CustomerDb", name: "db_accessadmin" },
            { database: "CustomerDb", name: "sales" },
        ],
        databases: [{ name: "CustomerDb" }],
        objects,
        columns: new Map([
            [
                "users",
                [
                    { name: "Id", typeDisplay: "int", nullable: false },
                    { name: "Display Name", typeDisplay: "nvarchar(100)", nullable: true },
                ],
            ],
            [
                "orders",
                [
                    { name: "OrderId", typeDisplay: "int", identity: true },
                    { name: "CustomerId", typeDisplay: "int", nullable: false },
                    { name: "ComputedTotal", typeDisplay: "money", computed: true },
                ],
            ],
        ]),
    });
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    return { runtime, features: new TsqlLanguageFeatureService(runtime, metadata) };
}

function object(id, schema, name, kind) {
    return {
        ref: { id, database: "CustomerDb" },
        database: "CustomerDb",
        schema,
        name,
        kind,
    };
}
