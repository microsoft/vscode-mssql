/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} = require("../dist/index.js");

suite("local and grammar completion", () => {
    // Verifies editor typing receives grammar keywords and batch-local variables without metadata.
    test("completes keywords and declared variables", async () => {
        const keyword = await complete("SELECT 1; SEL");
        assert.ok(keyword.some((item) => item.kind === "keyword" && item.label === "SELECT"));

        const variable = await complete("DECLARE @CustomerId int; SELECT @Cust");
        assert.ok(
            variable.some((item) => item.kind === "variable" && item.label === "@CustomerId"),
        );
    });

    // Verifies CREATE TABLE temp shapes remain available to later alias-qualified projections.
    test("completes temporary-table columns through aliases", async () => {
        const sql =
            "CREATE TABLE #work (Id int NOT NULL, Payload nvarchar(max)); SELECT w. FROM #work AS w;";
        const items = await complete(sql, sql.indexOf("w. FROM") + 2);
        assert.deepEqual(columnLabels(items), ["Id", "Payload"]);

        const acrossBatch = "CREATE TABLE #persisted (Id int);\nGO\nSELECT p. FROM #persisted p;";
        assert.deepEqual(
            columnLabels(await complete(acrossBatch, acrossBatch.indexOf("p. FROM") + 2)),
            ["Id"],
        );
    });

    // Verifies table variables obey GO batch scope while temporary tables remain connection-local.
    test("does not leak table-variable shapes across GO", async () => {
        const sql = "DECLARE @items TABLE (Id int);\nGO\nSELECT i. FROM @items i;";
        assert.deepEqual(columnLabels(await complete(sql, sql.indexOf("i. FROM") + 2)), []);
    });

    // Verifies CTE output aliases are bound without waiting for a remote catalog refresh.
    test("completes CTE projected columns", async () => {
        const sql = "WITH recent AS (SELECT 1 AS Id, 'x' AS Label) SELECT r. FROM recent r;";
        const items = await complete(sql, sql.indexOf("r. FROM") + 2);
        assert.deepEqual(columnLabels(items), ["Id", "Label"]);
    });

    // Verifies derived tables and SELECT INTO expose their projected shapes without an eager AST.
    test("completes derived and SELECT INTO shapes", async () => {
        const derived =
            "SELECT x. FROM (SELECT InvoiceId, Amount AS TotalAmount FROM dbo.Invoices) AS x;";
        assert.deepEqual(columnLabels(await complete(derived, derived.indexOf("x. FROM") + 2)), [
            "InvoiceId",
            "TotalAmount",
        ]);

        const into =
            "SELECT CustomerId, DisplayName INTO #active FROM dbo.Customers; SELECT a. FROM #active a;";
        assert.deepEqual(columnLabels(await complete(into, into.indexOf("a. FROM") + 2)), [
            "CustomerId",
            "DisplayName",
        ]);
    });

    // Verifies unqualified clause and INSERT-list completion reuse document-local table shapes.
    test("completes unqualified and INSERT target columns", async () => {
        const group =
            "CREATE TABLE #items (InvoiceId int, Amount money); SELECT COUNT(*) FROM #items GROUP BY ";
        assert.deepEqual(columnLabels(await complete(group)), ["Amount", "InvoiceId"]);

        const insert =
            "CREATE TABLE #customers (CustomerId int, DisplayName nvarchar(100)); INSERT INTO #customers (";
        assert.deepEqual(columnLabels(await complete(insert)), ["CustomerId", "DisplayName"]);
    });

    // Verifies CTE names participate in source completion, not only qualified member completion.
    test("completes local CTE source names", async () => {
        const sql = "WITH CurrentCustomers AS (SELECT 1 AS Id) SELECT * FROM Current";
        const items = await complete(sql);
        assert.ok(items.some((item) => item.label === "CurrentCustomers" && item.kind === "cte"));
    });

    // Verifies OPENJSON WITH and default OPENJSON shapes provide rowset member completion.
    test("completes OPENJSON rowset columns", async () => {
        const shaped =
            "SELECT j. FROM OPENJSON(@json) WITH (Id int '$.id', Name nvarchar(50) '$.name') j;";
        assert.deepEqual(columnLabels(await complete(shaped, shaped.indexOf("j. FROM") + 2)), [
            "Id",
            "Name",
        ]);

        const defaults = "SELECT j. FROM OPENJSON(@json) j;";
        assert.deepEqual(columnLabels(await complete(defaults, defaults.indexOf("j. FROM") + 2)), [
            "key",
            "type",
            "value",
        ]);
    });

    // Verifies incomplete VECTOR_SEARCH calls offer the documented named-parameter contract.
    test("completes VECTOR_SEARCH named parameters and output distance", async () => {
        const parameters = await complete("SELECT * FROM VECTOR_SEARCH(TABLE = dbo.Items, CO");
        assert.ok(parameters.some((item) => item.label === "COLUMN"));

        const sql =
            "SELECT ann. FROM VECTOR_SEARCH(TABLE=dbo.Items, COLUMN=embedding, SIMILAR_TO=@q, METRIC='cosine') ann;";
        assert.deepEqual(columnLabels(await complete(sql, sql.indexOf("ann. FROM") + 4)), [
            "distance",
        ]);
    });

    // Verifies the same local binding identity powers definitions, references, and safe rename edits.
    test("navigates and renames CTE identities", async () => {
        const sql = "WITH [recent] AS (SELECT 1 AS Id) SELECT r.Id FROM [recent] r;";
        const { features } = await services(sql);
        const offset = sql.lastIndexOf("recent") + 2;
        assert.deepEqual(features.definition("file:///local-completion.sql", 1, offset), [
            { uri: "file:///local-completion.sql", range: { start: 5, end: 13 } },
        ]);
        assert.equal(features.references("file:///local-completion.sql", 1, offset).length, 2);
        assert.deepEqual(features.rename("file:///local-completion.sql", 1, offset, "active"), [
            { start: 5, end: 13, newText: "[active]" },
            {
                start: sql.lastIndexOf("[recent]"),
                end: sql.lastIndexOf("[recent]") + 8,
                newText: "[active]",
            },
        ]);
    });

    // Verifies catalog-free column binding carries declaration and SQL type information into hover.
    test("hovers and defines local columns", async () => {
        const sql = "CREATE TABLE #work (Id int NOT NULL); SELECT w.Id FROM #work w;";
        const { features } = await services(sql);
        const offset = sql.indexOf("w.Id") + 3;
        const hover = features.hover("file:///local-completion.sql", 1, offset);

        assert.match(hover.markdown, /Type: `int NOT NULL`/);
        assert.deepEqual(features.definition("file:///local-completion.sql", 1, offset), [
            { uri: "file:///local-completion.sql", range: { start: 20, end: 22 } },
        ]);
    });
});

async function complete(sql, offset = sql.length) {
    const { features } = await services(sql);
    return features.completion("file:///local-completion.sql", 1, offset).items;
}

async function services(sql) {
    const metadata = new InMemoryMetadataProvider();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(undefined, { serverMajorVersion: 17, compatibilityLevel: 170 }),
        new CatalogSemanticBinder(),
        metadata,
    );
    const features = new TsqlLanguageFeatureService(runtime, metadata);
    await runtime.open("file:///local-completion.sql", 1, sql);
    return { features, runtime };
}

function columnLabels(items) {
    return items
        .filter((item) => item.kind === "column")
        .map((item) => item.label)
        .sort();
}
