/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { after, before, suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    SimpleQueryMetadataAdapter,
    TsqlLanguageFeatureService,
    createEngineCapabilities,
    unknownEngineCapabilities,
} = require("../../dist/index.js");
const { SqlServerCatalogLoader } = require("./sqlServerCatalogLoader.js");
const {
    connectionString,
    connectionStringForDatabase,
    rowsAsObjects,
    TediousTestClient,
} = require("./tediousTestClient.js");
const realWorldFixtureRoot = path.join(__dirname, "../fixtures/real-world-sql");
const realWorldManifest = require("../fixtures/real-world-sql/manifest.json");

const regressionDatabases = [
    "AdventureWorks2022",
    "Issue21930Repro_6d31c8a4",
    "WideWorldImporters",
];

suite("SQL Server end-to-end integration", { skip: !connectionString }, () => {
    let client;

    before(async () => {
        client = new TediousTestClient(connectionString);
        await client.connect();
    });

    after(async () => client?.close());

    // Resolves the engine profile from the facts the live server actually reports, so the mapping
    // is proved against a server rather than only against the offline table. Engines this
    // repository cannot reach are covered by the deterministic dialect inventory instead.
    test("resolves the connected engine profile from live server facts", async () => {
        const rows = rowsAsObjects(
            await client.execute(
                "SELECT CONVERT(int, SERVERPROPERTY('EngineEdition')) AS engine_edition," +
                    " CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS server_version," +
                    " CONVERT(nvarchar(256), SERVERPROPERTY('ServerName')) AS server_name," +
                    " (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compatibility_level;",
            ),
        );
        const facts = {
            engineEdition: Number(rows[0].engine_edition),
            serverVersion: String(rows[0].server_version),
            serverName: String(rows[0].server_name),
            compatibilityLevel: Number(rows[0].compatibility_level),
        };
        const capabilities = createEngineCapabilities(facts);

        assert.notEqual(
            capabilities.engineProfile,
            "unknown",
            `a live server must identify itself: ${capabilities.resolution.reason}`,
        );
        assert.equal(capabilities.resolution.source, "engineEdition");
        assert.equal(capabilities.compatibilityLevel, facts.compatibilityLevel);
        assert.equal(
            capabilities.generation,
            `${capabilities.engineProfile}/${capabilities.serverMajorVersion}/${capabilities.compatibilityLevel}/ga`,
        );

        // A document opened against the live facts is analysed under that profile, and a construct
        // the engine does not have is reported as unavailable rather than as a syntax error.
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, unknownEngineCapabilities),
        );
        const uri = "integration:/profile.sql";
        await runtime.open(uri, 1, "CREATE TABLE dbo.t ( a int ) WITH ( CLUSTER BY (a) );");
        await runtime.setEngineFacts(facts);
        const snapshot = runtime.snapshot(uri, 1);
        assert.equal(snapshot.syntax.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(
            snapshot.syntax.diagnostics.map((diagnostic) => diagnostic.availability?.featureId),
            capabilities.engineProfile === "fabric-warehouse" ? [] : ["table.cluster-by"],
        );
        await runtime.close(uri);
    });

    // Confirms the configured Docker SQL Server accepts an encrypted tedious connection.
    test("connects and executes a read-only query", async () => {
        const rows = rowsAsObjects(
            await client.execute(
                "SELECT DB_NAME() AS database_name, CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS server_version;",
            ),
        );
        assert.equal(rows.length, 1);
        assert.ok(rows[0].database_name);
        assert.match(String(rows[0].server_version), /^\d+\./u);
    });

    // Exercises real catalog refresh, lazy columns, binding, completion, and hover as one path.
    test("loads metadata and serves language features", async () => {
        const loader = new SqlServerCatalogLoader();
        const metadata = new SimpleQueryMetadataAdapter(client, loader);
        const refresh = await metadata.refresh();
        assert.equal(refresh.published, true);

        const resolution = metadata.pin().resolveObject(["sys", "objects"]);
        assert.equal(resolution.kind, "resolved");
        metadata.requestHydration({
            section: "columns",
            object: resolution.object.ref,
            priority: "interactive",
        });
        await waitFor(() => metadata.pin().columnState(resolution.object.ref).kind === "loaded");

        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const uri = "file:///integration.sql";
        const sql = "SELECT o.object_id, o.name FROM sys.objects AS o;";
        const snapshot = await runtime.open(uri, 1, sql);
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ severity }) => severity === "error"),
            [],
        );

        const completionSql = "SELECT o. FROM sys.objects AS o;";
        await runtime.open(uri, 2, completionSql);
        const items = features.completion(uri, 2, completionSql.indexOf("o.") + 2).items;
        assert.ok(items.some((item) => item.kind === "column" && item.label === "object_id"));
        assert.ok(items.some((item) => item.kind === "column" && item.label === "name"));

        await runtime.open(uri, 3, sql);
        const hover = features.hover(uri, 3, sql.indexOf("objects") + 2);
        assert.match(hover.markdown, /\*\*(?:system )?(?:table|view)\*\*/u);
        assert.match(hover.markdown, /object_id/u);

        // Manual completion at the end of a query waits for lazy columns without requiring an edit.
        const starSql = "SELECT * FROM INFORMATION_SCHEMA.TABLES";
        await runtime.open(uri, 4, starSql);
        let starResult = features.completion(uri, 4, starSql.length);
        if (starResult.incomplete) {
            await metadata.waitForHydration();
            // Feature requests intentionally read one pinned catalog generation. A host rebinds
            // after metadata publication; this direct-runtime test performs the same lifecycle.
            await runtime.rebind(uri, 4);
            starResult = features.completion(uri, 4, starSql.length);
        }
        assert.ok(starResult.items.some((item) => item.label === "Expand SELECT *"));

        // Verifies real catalog completion replaces only the contents of bracketed identifiers.
        const bracketSql = "SELECT * FROM [sys].[]";
        const bracketOffset = bracketSql.lastIndexOf("[") + 1;
        await runtime.open(uri, 5, bracketSql);
        const bracketResult = features.completion(uri, 5, bracketOffset);
        const allColumns = bracketResult.items.find((item) => item.label === "all_columns");
        assert.ok(allColumns);
        assert.deepEqual(allColumns.edit, {
            start: bracketOffset,
            end: bracketOffset,
            newText: "all_columns",
        });

        // An empty unqualified bracket is a schema-or-object context, not a document-word
        // fallback. This is the exact editor shape produced by typing SELECT ... FROM [].
        const unqualifiedBracketSql = "SELECT * FROM []";
        const unqualifiedBracketOffset = unqualifiedBracketSql.indexOf("[") + 1;
        await runtime.open(uri, 6, unqualifiedBracketSql);
        const unqualifiedBracketResult = features.completion(uri, 6, unqualifiedBracketOffset);
        const dbo = unqualifiedBracketResult.items.find(
            (item) => item.kind === "schema" && item.label === "dbo",
        );
        assert.ok(dbo);
        assert.deepEqual(dbo.edit, {
            start: unqualifiedBracketOffset,
            end: unqualifiedBracketOffset,
            newText: "dbo",
        });

        // Reproduces preview completion inside editor-inserted parentheses on a real system view.
        const insertSql = "INSERT INTO sys.all_columns ()";
        const insertOffset = insertSql.indexOf("(") + 1;
        await runtime.open(uri, 7, insertSql);
        let insertResult = features.completion(uri, 7, insertOffset);
        if (insertResult.incomplete) {
            await metadata.waitForHydration();
            await runtime.rebind(uri, 7);
            insertResult = features.completion(uri, 7, insertOffset);
        }
        const insertExpansion = insertResult.items.find(
            (item) => item.label === "Expand INSERT columns and VALUES",
        );
        assert.ok(insertExpansion);
        assert.equal(insertExpansion.edit.start, insertOffset);
        assert.equal(insertExpansion.edit.end, insertSql.length);
        assert.equal(insertExpansion.insertTextFormat, "snippet");
        assert.equal(insertExpansion.preselect, true);

        for (const query of loader.queries.filter((value) => /\bsys\./iu.test(value))) {
            const catalogReferences = query.matchAll(/\b(?:FROM|JOIN)\s+sys\.[\p{L}_]+[^\n]*/giu);
            for (const reference of catalogReferences) {
                assert.match(reference[0], /WITH\s*\(NOLOCK\)/iu);
            }
        }
    });

    // Guards catalog-view binding and type-argument handling against three real, read-only catalogs.
    test("binds system catalog queries in representative databases", async () => {
        for (const database of regressionDatabases) {
            const databaseClient = new TediousTestClient(connectionStringForDatabase(database));
            await databaseClient.connect();
            try {
                const loader = new SqlServerCatalogLoader();
                const metadata = new SimpleQueryMetadataAdapter(databaseClient, loader);
                await metadata.refresh();
                assert.equal(metadata.pin().environment.currentDatabase, database);

                const names = ["objects", "tables", "types", "schemas", "all_objects"];
                for (const name of names) {
                    const resolution = metadata.pin().resolveObject(["sys", name]);
                    assert.equal(resolution.kind, "resolved", `${database}.sys.${name}`);
                    metadata.requestHydration({
                        section: "columns",
                        object: resolution.object.ref,
                        priority: "interactive",
                    });
                }
                await waitFor(() =>
                    names.every((name) => {
                        const resolution = metadata.pin().resolveObject(["sys", name]);
                        return (
                            resolution.kind === "resolved" &&
                            metadata.pin().columnState(resolution.object.ref).kind === "loaded"
                        );
                    }),
                );

                const runtime = new InProcessLanguageServiceRuntime(
                    new LezerSyntaxService(),
                    new CatalogSemanticBinder(),
                    metadata,
                );
                const features = new TsqlLanguageFeatureService(runtime, metadata);
                const snapshot = await runtime.open(
                    `file:///integration-${database}.sql`,
                    1,
                    representativeCatalogSql,
                );
                assert.deepEqual(snapshot.syntax.diagnostics, [], database);
                assert.deepEqual(
                    snapshot.semantics.diagnostics.filter(({ severity }) => severity === "error"),
                    [],
                    database,
                );

                const completionSql = "SELECT * FROM sys.obj";
                await runtime.open(`file:///completion-${database}.sql`, 1, completionSql);
                const completion = features.completion(
                    `file:///completion-${database}.sql`,
                    1,
                    completionSql.length,
                );
                assert.ok(
                    completion.items.some(
                        (item) => item.kind === "view" && item.label === "objects",
                    ),
                    `${database} system catalog completion`,
                );

                // Bind the complete checked-in SQL workspace regression set against each real
                // catalog. Only explicitly intentional findings are allowed; this catches broad
                // catalog false positives without executing any fixture SQL.
                for (const fixture of realWorldManifest.files) {
                    const sql = readFileSync(path.join(realWorldFixtureRoot, fixture.path), "utf8");
                    const fixtureSnapshot = await runtime.open(
                        `file:///live-regression/${encodeURIComponent(database)}/${fixture.path}`,
                        1,
                        sql,
                    );
                    assert.deepEqual(
                        fixtureSnapshot.semantics.diagnostics.map(({ code, message }) => ({
                            code,
                            message,
                        })),
                        expectedLiveDiagnostics(fixture),
                        `${database}: ${fixture.path}`,
                    );
                }
            } finally {
                await databaseClient.close();
            }
        }
    });

    // Verifies lazy key metadata supports implicit foreign-key binding without executing DDL.
    test("binds foreign keys against live primary-key metadata", async () => {
        const databaseClient = new TediousTestClient(
            connectionStringForDatabase("AdventureWorks2022"),
        );
        await databaseClient.connect();
        try {
            const loader = new SqlServerCatalogLoader();
            const metadata = new SimpleQueryMetadataAdapter(databaseClient, loader);
            await metadata.refresh();
            const resolution = metadata.pin().resolveObject(["Person", "Person"]);
            assert.equal(resolution.kind, "resolved");
            metadata.requestHydration({
                section: "columns",
                object: resolution.object.ref,
                priority: "interactive",
            });
            await metadata.waitForHydration();
            const columns = metadata.pin().columnState(resolution.object.ref);
            assert.equal(columns.kind, "loaded");
            assert.equal(
                columns.value.find(({ name }) => name === "BusinessEntityID")?.primaryKeyOrdinal,
                1,
            );

            const runtime = new InProcessLanguageServiceRuntime(
                new LezerSyntaxService(),
                new CatalogSemanticBinder(),
                metadata,
            );
            const valid = await runtime.open(
                "file:///foreign-key-valid.sql",
                1,
                "CREATE TABLE dbo.PersonReference (BusinessEntityID int REFERENCES Person.Person);",
            );
            assert.deepEqual(
                valid.semantics.diagnostics.filter(({ severity }) => severity === "error"),
                [],
            );
            const invalid = await runtime.open(
                "file:///foreign-key-invalid.sql",
                1,
                "CREATE TABLE dbo.PersonReference (BusinessEntityID bigint REFERENCES Person.Person);",
            );
            assert.ok(
                invalid.semantics.diagnostics.some(
                    ({ code }) => code === "ColumnIsNotSameTypeAsRefColumn",
                ),
            );
        } finally {
            await databaseClient.close();
        }
    });

    // Exercises the actual lazy metadata path used by database.schema.object completion.
    test("hydrates cross-database schemas and objects for completion", async () => {
        const databaseClient = new TediousTestClient(
            connectionStringForDatabase("Issue21930Repro_6d31c8a4"),
        );
        await databaseClient.connect();
        try {
            const loader = new SqlServerCatalogLoader();
            const metadata = new SimpleQueryMetadataAdapter(databaseClient, loader);
            await metadata.refresh();
            const runtime = new InProcessLanguageServiceRuntime(
                new LezerSyntaxService(),
                new CatalogSemanticBinder(),
                metadata,
            );
            const features = new TsqlLanguageFeatureService(runtime, metadata);

            const schemaSql = "SELECT * FROM AdventureWorks2022.Per";
            await runtime.open("file:///cross-database-schema.sql", 1, schemaSql);
            let schemas = features.completion(
                "file:///cross-database-schema.sql",
                1,
                schemaSql.length,
            );
            assert.equal(schemas.incomplete, true);
            await waitFor(
                () =>
                    metadata.pin().databaseCatalogCompleteness("AdventureWorks2022").schemas ===
                    "ready",
            );
            await runtime.rebind("file:///cross-database-schema.sql", 1);
            schemas = features.completion("file:///cross-database-schema.sql", 1, schemaSql.length);
            assert.ok(schemas.items.some((item) => item.label === "Person"));

            const objectSql = "SELECT * FROM AdventureWorks2022.Person.Per";
            await runtime.open("file:///cross-database-object.sql", 1, objectSql);
            let objects = features.completion(
                "file:///cross-database-object.sql",
                1,
                objectSql.length,
            );
            assert.equal(objects.incomplete, true);
            await waitFor(
                () =>
                    metadata.pin().databaseCatalogCompleteness("AdventureWorks2022").objects ===
                    "ready",
            );
            await runtime.rebind("file:///cross-database-object.sql", 1);
            objects = features.completion("file:///cross-database-object.sql", 1, objectSql.length);
            assert.ok(
                objects.items.some((item) => item.kind === "table" && item.label === "Person"),
            );

            for (const query of loader.queries.filter((value) => /\.sys\./iu.test(value))) {
                for (const reference of query.matchAll(
                    /\b(?:FROM|JOIN)\s+\[[^\]]+\]\.sys\.[\p{L}_]+[^\n]*/giu,
                )) {
                    assert.match(reference[0], /WITH\s*\(NOLOCK\)/iu);
                }
            }
        } finally {
            await databaseClient.close();
        }
    });
});

// This is the complete checked-in rendering regression, not a reduced hand-authored sample.
const representativeCatalogSql = readFileSync(
    path.join(realWorldFixtureRoot, "catalog/system-catalog-rendering.sql"),
    "utf8",
);

function expectedLiveDiagnostics(fixture) {
    const expected = [...fixture.expectedSemanticDiagnostics];
    if (fixture.path === "stress/tricky-bracket-identifiers.sql") {
        expected.push({
            code: "CouldNotLocateEntryInSysdatabases",
            message:
                "Could not locate entry in sysdatabases for database 'Verify_Hierarchy_Baseline_Sqlv150'']]]'{a15a7e31-47ab-48f4-a380-42279406d3ed}'. No entry found with that name. Make sure that the name is entered correctly.",
        });
    }
    return expected;
}

async function waitFor(predicate) {
    const deadline = performance.now() + 10_000;
    while (!predicate()) {
        if (performance.now() > deadline)
            throw new Error("Timed out waiting for metadata hydration.");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
