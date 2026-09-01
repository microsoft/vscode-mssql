/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    resolveTsqlFeatureProfile,
    TsqlLanguageFeatureService,
    type CompletionItem,
} from "../../../../src/index.ts";

suite("local and grammar completion", () => {
    // Verifies editor typing receives grammar keywords and batch-local variables without metadata.
    test("completes keywords and declared variables", async () => {
        const keyword = await complete("SELECT 1; SEL");
        assert.ok(keyword.some((item) => item.kind === "keyword" && item.label === "SELECT"));

        const variable = await complete("DECLARE @CustomerId int; SELECT @Cust");
        assert.ok(
            variable.some((item) => item.kind === "variable" && item.label === "@CustomerId"),
        );

        const broadKeyword = await complete("CHECKP");
        assert.ok(
            broadKeyword.some((item) => item.kind === "keyword" && item.label === "CHECKPOINT"),
        );
    });

    test("keeps unqualified symbols within their query scope", async () => {
        const prior = "SELECT 1 FROM (SELECT 1 AS Id) AS priorAlias; SELECT prior;";
        const priorItems = await complete(prior, prior.indexOf("prior;", 30) + "prior".length);
        assert.ok(!priorItems.some((item) => item.label === "priorAlias"));

        const future = "SELECT future; SELECT 1 FROM (SELECT 1 AS Id) AS futureAlias;";
        const futureItems = await complete(future, future.indexOf("future;") + "future".length);
        assert.ok(!futureItems.some((item) => item.label === "futureAlias"));

        const nested =
            "SELECT (SELECT 1 FROM (SELECT 1 AS Id) AS scopeLeft), (SELECT scope FROM (SELECT 1 AS Id) AS scopeRight);";
        const nestedItems = await complete(nested, nested.indexOf("scope FROM") + "scope".length);
        assert.ok(!nestedItems.some((item) => item.label === "scopeLeft"));
        assert.ok(nestedItems.some((item) => item.kind === "alias" && item.label === "scopeRight"));

        const variable = "DECLARE @batchValue int; SELECT @batch";
        assert.ok(
            (await complete(variable)).some(
                (item) => item.kind === "variable" && item.label === "@batchValue",
            ),
        );
    });

    // Verifies expression and declaration contexts expose built-ins and modern SQL Server types.
    test("completes built-in functions and data types", async () => {
        const functions = await complete("SELECT JSON_");
        assert.ok(
            functions.some((item) => item.kind === "function" && item.label === "JSON_VALUE"),
        );
        assert.ok(functions.some((item) => item.label === "JSON_OBJECT"));

        const types = await complete("DECLARE @payload JS");
        assert.ok(types.some((item) => item.kind === "type" && item.label === "JSON"));
        const vector = await complete("DECLARE @embedding VEC");
        assert.ok(vector.some((item) => item.kind === "type" && item.label === "VECTOR"));
    });

    // Every incomplete type owner is recognized from its recovered grammar node. A keyword in a
    // previous statement or literal cannot leak into these decisions through backward text scans.
    test("completes data types from recovered structural owners", async () => {
        for (const sql of [
            "DECLARE @v IN",
            "CREATE TABLE dbo.T (c IN",
            "SELECT CAST(1 AS IN",
            "CREATE PROCEDURE dbo.p @v IN",
            "CREATE FUNCTION dbo.f() RETURNS IN",
            "ALTER TABLE dbo.T ALTER COLUMN c IN",
            "CREATE TYPE dbo.alias FROM IN",
        ]) {
            const items = await complete(sql);
            assert.ok(
                items.some((item) => item.kind === "type" && item.label === "INT"),
                sql,
            );
        }

        const expression = await complete("RETURN JSON_");
        assert.ok(expression.some((item) => item.label === "JSON_VALUE"));
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

    test("preserves CTE column types and gives columns the source-first rank", async () => {
        const sql = [
            "WITH Base AS (SELECT 1 AS Id, 'x' AS Label),",
            "Combined AS (SELECT b.* FROM Base AS b)",
            "SELECT c. FROM Combined AS c;",
        ].join("\n");
        const items = await complete(sql, sql.indexOf("c. FROM") + "c.".length);
        const id = items.find((item) => item.label === "Id" && item.kind === "column");
        const label = items.find((item) => item.label === "Label" && item.kind === "column");

        assert.equal(id?.detail, "int — c");
        assert.equal(label?.detail, "varchar — c");
        assert.match(id?.sortText ?? "", /^02-/u);
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

    test("completes only local rowsets that are alive at the cursor", async () => {
        const expired = "WITH expired AS (SELECT 1 AS Id) SELECT * FROM expired; SELECT * FROM exp";
        assert.ok(!(await complete(expired)).some((item) => item.label === "expired"));

        const future =
            "SELECT * FROM fut; WITH futureCte AS (SELECT 1 AS Id) SELECT * FROM futureCte;";
        assert.ok(
            !(await complete(future, future.indexOf("fut;") + 3)).some(
                (item) => item.label === "futureCte",
            ),
        );

        const forward =
            "WITH firstCte AS (SELECT * FROM lat), laterCte AS (SELECT 1 AS Id) SELECT * FROM firstCte;";
        assert.ok(
            !(await complete(forward, forward.indexOf("lat)") + 3)).some(
                (item) => item.label === "laterCte",
            ),
        );

        const beforeCreate = "SELECT * FROM #lat; CREATE TABLE #later (Id int);";
        assert.ok(
            !(await complete(beforeCreate, beforeCreate.indexOf("#lat;") + 4)).some(
                (item) => item.label === "#later",
            ),
        );

        const afterDrop = "CREATE TABLE #gone (Id int); DROP TABLE #gone; SELECT * FROM #go";
        assert.ok(!(await complete(afterDrop)).some((item) => item.label === "#gone"));

        const acrossBatch = "CREATE TABLE #persisted (Id int);\nGO\nSELECT * FROM #per";
        assert.ok(
            (await complete(acrossBatch)).some(
                (item) => item.label === "#persisted" && item.kind === "tempTable",
            ),
        );

        const selectInto = "SELECT CustomerId INTO #active FROM dbo.Customers; SELECT * FROM #act";
        assert.ok(
            (await complete(selectInto)).some(
                (item) => item.label === "#active" && item.kind === "tempTable",
            ),
        );

        const tableVariable = "DECLARE @items TABLE (Id int); SELECT * FROM @it";
        assert.ok(
            (await complete(tableVariable)).some(
                (item) => item.label === "@items" && item.kind === "variable",
            ),
        );
    });

    test("does not expose columns from an expired CTE", async () => {
        const sql =
            "WITH expired AS (SELECT 1 AS ExpiredColumn) SELECT * FROM expired; SELECT expired. FROM expired;";
        assert.deepEqual(
            columnLabels(await complete(sql, sql.indexOf("expired. FROM") + "expired.".length)),
            [],
        );
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

    // Correlated scalar subqueries see aliases from their enclosing query scope.
    test("completes and hovers correlated outer-query columns", async () => {
        const sql = `CREATE TABLE dbo.EmployeeData (ID int, Department nvarchar(20));
GO
SELECT (
    SELECT emp.ID
    FROM dbo.EmployeeData AS emp
    WHERE emp.Department = dept.Dep
)
FROM (SELECT DISTINCT Department FROM dbo.EmployeeData) AS dept;`;
        const offset = sql.indexOf("dept.Dep") + "dept.Dep".length;
        assert.deepEqual(columnLabels(await complete(sql, offset)), ["Department"]);

        const valid = sql.replace("dept.Dep", "dept.Department");
        const { features } = await services(valid);
        const hover = features.hover(
            "file:///local-completion.sql",
            1,
            valid.indexOf("dept.Department") + "dept.".length + 2,
        );
        assert.ok(hover);
        assert.match(hover.markdown, /\*\*column\*\* `Department`/u);
        const declaration = valid.lastIndexOf("Department FROM");
        assert.deepEqual(
            features.definition(
                "file:///local-completion.sql",
                1,
                valid.indexOf("dept.Department") + "dept.".length + 2,
            ),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: { start: declaration, end: declaration + "Department".length },
                },
            ],
        );
    });

    // XML nodes() and generic rowset column-alias lists expose their declared output shape.
    test("completes XML nodes rowset columns", async () => {
        const sql =
            "CREATE TABLE #docs (Payload xml); SELECT T.Sp FROM #docs CROSS APPLY Payload.nodes('/') AS T(Spec);";
        const offset = sql.indexOf("T.Sp") + "T.Sp".length;
        assert.deepEqual(columnLabels(await complete(sql, offset)), ["Spec"]);

        const valid = sql.replace("T.Sp", "T.Spec");
        const { features } = await services(valid);
        const declaration = valid.lastIndexOf("Spec)");
        assert.deepEqual(
            features.definition(
                "file:///local-completion.sql",
                1,
                valid.indexOf("T.Spec") + "T.".length + 2,
            ),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: { start: declaration, end: declaration + "Spec".length },
                },
            ],
        );
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

    test("keeps repeated and forward CTE identities separate", async () => {
        const repeated =
            "WITH c AS (SELECT 1 AS A) SELECT * FROM c; WITH c AS (SELECT 2 AS B) SELECT * FROM c;";
        const { features: repeatedFeatures } = await services(repeated);
        const firstDeclaration = repeated.indexOf("c AS");
        const secondDeclaration = repeated.indexOf("c AS", firstDeclaration + 1);
        const firstReference = repeated.indexOf("FROM c") + "FROM ".length;
        const secondReference = repeated.indexOf("FROM c", firstReference + 1) + "FROM ".length;
        assert.deepEqual(
            repeatedFeatures.definition("file:///local-completion.sql", 1, firstReference),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: { start: firstDeclaration, end: firstDeclaration + 1 },
                },
            ],
        );
        assert.deepEqual(
            repeatedFeatures.definition("file:///local-completion.sql", 1, secondReference),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: { start: secondDeclaration, end: secondDeclaration + 1 },
                },
            ],
        );

        const forward =
            "WITH firstCte AS (SELECT * FROM laterCte), laterCte AS (SELECT 1 AS Id) SELECT * FROM firstCte;";
        const { features: forwardFeatures, snapshot } = await services(forward);
        const forwardReference = forward.indexOf("laterCte");
        assert.deepEqual(
            forwardFeatures.definition("file:///local-completion.sql", 1, forwardReference),
            [],
        );
        assert.ok(
            snapshot.semantics.diagnostics.some(
                (diagnostic) =>
                    diagnostic.code === "MSSQL208" &&
                    forward.slice(diagnostic.range.start, diagnostic.range.end) === "laterCte",
            ),
        );
    });

    test("navigates temp-table and SELECT INTO declarations", async () => {
        const acrossBatch =
            "CREATE TABLE #persisted (Id int);\nGO\nSELECT p.Id FROM #persisted AS p;";
        const { features: acrossBatchFeatures } = await services(acrossBatch);
        const tableDeclaration = acrossBatch.indexOf("#persisted");
        const tableReference = acrossBatch.lastIndexOf("#persisted");
        assert.deepEqual(
            acrossBatchFeatures.definition("file:///local-completion.sql", 1, tableReference + 1),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: {
                        start: tableDeclaration,
                        end: tableDeclaration + "#persisted".length,
                    },
                },
            ],
        );
        const columnDeclaration = acrossBatch.indexOf("Id int");
        const columnReference = acrossBatch.indexOf("p.Id") + 2;
        assert.deepEqual(
            acrossBatchFeatures.definition("file:///local-completion.sql", 1, columnReference),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: { start: columnDeclaration, end: columnDeclaration + 2 },
                },
            ],
        );

        const selectInto = "SELECT Id INTO #active FROM dbo.Users; SELECT a.Id FROM #active AS a;";
        const { features: selectIntoFeatures } = await services(selectInto);
        const intoDeclaration = selectInto.indexOf("#active");
        const intoReference = selectInto.lastIndexOf("#active");
        assert.deepEqual(
            selectIntoFeatures.definition("file:///local-completion.sql", 1, intoReference + 1),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: {
                        start: intoDeclaration,
                        end: intoDeclaration + "#active".length,
                    },
                },
            ],
        );
    });

    test("binds each local-table reference to the live declaration", async () => {
        const recreated =
            "CREATE TABLE #work (FirstColumn int); SELECT * FROM #work; DROP TABLE #work; CREATE TABLE #work (SecondColumn int); SELECT * FROM #work;";
        const { features } = await services(recreated);
        const firstDeclaration = recreated.indexOf("#work");
        const firstReference = recreated.indexOf("#work", firstDeclaration + 1);
        const secondDeclaration = recreated.indexOf("#work", firstReference + 1);
        const recreatedDeclaration = recreated.indexOf("#work", secondDeclaration + 1);
        const secondReference = recreated.indexOf("#work", recreatedDeclaration + 1);
        assert.deepEqual(
            features.definition("file:///local-completion.sql", 1, firstReference + 1),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: {
                        start: firstDeclaration,
                        end: firstDeclaration + "#work".length,
                    },
                },
            ],
        );
        assert.deepEqual(
            features.definition("file:///local-completion.sql", 1, secondReference + 1),
            [
                {
                    uri: "file:///local-completion.sql",
                    range: {
                        start: recreatedDeclaration,
                        end: recreatedDeclaration + "#work".length,
                    },
                },
            ],
        );

        const beforeCreate = "SELECT * FROM #later; CREATE TABLE #later (Id int);";
        const { features: beforeFeatures } = await services(beforeCreate);
        assert.deepEqual(
            beforeFeatures.definition(
                "file:///local-completion.sql",
                1,
                beforeCreate.indexOf("#later") + 1,
            ),
            [],
        );

        const afterDrop = "CREATE TABLE #gone (Id int); DROP TABLE #gone; SELECT * FROM #gone;";
        const { features: afterFeatures } = await services(afterDrop);
        assert.deepEqual(
            afterFeatures.definition(
                "file:///local-completion.sql",
                1,
                afterDrop.lastIndexOf("#gone") + 1,
            ),
            [],
        );
    });

    // Verifies catalog-free column binding carries declaration and SQL type information into hover.
    test("hovers and defines local columns", async () => {
        const sql = "CREATE TABLE #work (Id int NOT NULL); SELECT w.Id FROM #work w;";
        const { features } = await services(sql);
        const offset = sql.indexOf("w.Id") + 3;
        const hover = features.hover("file:///local-completion.sql", 1, offset);

        assert.ok(hover);
        assert.match(hover.markdown, /Type: `int NOT NULL`/);
        assert.deepEqual(features.definition("file:///local-completion.sql", 1, offset), [
            { uri: "file:///local-completion.sql", range: { start: 20, end: 22 } },
        ]);
    });
});

async function complete(sql: string, offset = sql.length): Promise<readonly CompletionItem[]> {
    const { features } = await services(sql);
    return features.completion("file:///local-completion.sql", 1, offset).items;
}

async function services(sql: string) {
    const metadata = new InMemoryMetadataProvider();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(
            undefined,
            resolveTsqlFeatureProfile({ serverMajorVersion: 17, compatibilityLevel: 170 }),
        ),
        new CatalogSemanticBinder(),
        metadata,
    );
    const features = new TsqlLanguageFeatureService(runtime, metadata);
    const snapshot = await runtime.open("file:///local-completion.sql", 1, sql);
    return { features, runtime, snapshot };
}

function columnLabels(items: readonly CompletionItem[]): string[] {
    return items
        .filter((item) => item.kind === "column")
        .map((item) => item.label)
        .sort();
}
