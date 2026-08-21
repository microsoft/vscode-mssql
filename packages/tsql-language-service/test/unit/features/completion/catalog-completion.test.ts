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
    TsqlLanguageFeatureService,
} from "../../../../src/index.ts";
import {
    applyCompletion,
    createCatalogFeatureServices as createServices,
    object,
} from "../../support/catalogFeatureHarness.ts";
import { assertDefined, defined } from "../../support/assertions.ts";

suite("catalog completion", () => {
    // Feature requests must read the immutable catalog generation used for binding. A provider may
    // publish a new generation between an edit and rebind; mixing it into the old semantic model
    // would make completion, hover, and diagnostics disagree for the same document version.
    test("keeps feature metadata pinned until the document is rebound", async () => {
        const metadata = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            databases: [{ name: "db" }],
            schemas: [{ database: "db", name: "dbo" }],
            objects: [object("old", "dbo", "OldTable", "table", "db")],
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const uri = "file:///pinned-feature-metadata.sql";
        const sql = "SELECT * FROM dbo.";
        await runtime.open(uri, 1, sql);

        metadata.replace({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            databases: [{ name: "db" }],
            schemas: [{ database: "db", name: "dbo" }],
            objects: [object("new", "dbo", "NewTable", "table", "db")],
        });
        let labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);
        assert.ok(labels.includes("OldTable"));
        assert.ok(!labels.includes("NewTable"));

        await runtime.rebind(uri, 1);
        labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);
        assert.ok(!labels.includes("OldTable"));
        assert.ok(labels.includes("NewTable"));
    });

    // Verifies user catalog entries sort alphabetically before all system catalog entries.
    test("ranks user schemas and objects before system catalog entries", async () => {
        const { runtime, features } = createServices();
        const schemasSql = "SELECT * FROM ";
        await runtime.open("file:///schemas.sql", 1, schemasSql);
        const schemas = features.completion("file:///schemas.sql", 1, schemasSql.length).items;
        const sort = Object.fromEntries(schemas.map((item) => [item.label, item.sortText]));
        assert.match(defined(sort.sales), /^10-/);
        assert.match(defined(sort.dbo), /^10-/);
        assert.match(defined(sort.reporting), /^10-/);
        assert.ok(defined(sort.reporting) < defined(sort.sys));
        assert.match(defined(sort.sys), /^90-/);
        assert.match(defined(sort.db_accessadmin), /^90-/);
        assert.match(defined(sort.CustomerDb), /^10-/);
        assert.match(defined(sort.master), /^90-/);

        const objectsSql = "SELECT * FROM dbo.";
        await runtime.open("file:///objects.sql", 1, objectsSql);
        const objects = features.completion("file:///objects.sql", 1, objectsSql.length).items;
        assert.ok(
            defined(defined(objects.find((item) => item.label === "Users")).sortText) <
                defined(defined(objects.find((item) => item.label === "sysobjects")).sortText),
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
    // An unqualified result outside the default schema inserts a valid two-part object name.
    test("schema-qualifies cross-schema object completion edits", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT * FROM Us";
        await runtime.open("file:///cross-schema-edit.sql", 1, sql);
        const item = features
            .completion("file:///cross-schema-edit.sql", 1, sql.length)
            .items.find((candidate) => candidate.label === "Users");

        assertDefined(item);
        assert.deepEqual(item.edit, {
            start: sql.length - 2,
            end: sql.length,
            newText: "dbo.Users",
        });
    });
    // Verifies catalog routing treats the cursor inside [] as an editable identifier context.
    test("completes schemas and objects inside bracketed identifiers", async () => {
        const { runtime, features } = createServices();
        const cases = [
            ["SELECT * FROM []", "Orders", "SELECT * FROM [Orders]"],
            ["SELECT * FROM []", "dbo.Users", "SELECT * FROM [dbo].[Users]"],
            ["SELECT * FROM [sales].[]", "Orders", "SELECT * FROM [sales].[Orders]"],
            [
                "SELECT * FROM [ArchiveDb].[history].[]",
                "Orders2024",
                "SELECT * FROM [ArchiveDb].[history].[Orders2024]",
            ],
        ] as const;

        for (const [sql, label, expected] of cases) {
            const uri = `file:///bracket-${label.replaceAll(".", "-")}.sql`;
            const offset = sql.lastIndexOf("[") + 1;
            await runtime.open(uri, 1, sql);
            const item = features
                .completion(uri, 1, offset)
                .items.find((candidate) => candidate.label === label);

            assert.ok(item, `${label} in ${sql}`);
            assertDefined(item.edit);
            assert.equal(item.edit.start, offset);
            assert.equal(item.edit.end, offset);
            assert.equal(applyCompletion(sql, item), expected);
        }
    });
    // Verifies a typed prefix replaces the complete identifier content but preserves its quotes.
    test("completes bracketed and double-quoted identifier prefixes", async () => {
        const { runtime, features } = createServices();
        const cases = [
            ["SELECT * FROM [sal", "sales", "SELECT * FROM [sales]"],
            ["SELECT * FROM [sales].[Or]", "Orders", "SELECT * FROM [sales].[Orders]"],
            ['SELECT * FROM "sales"."Or"', "Orders", 'SELECT * FROM "sales"."Orders"'],
        ] as const;

        for (const [sql, label, expected] of cases) {
            const uri = `file:///quoted-${label}-${sql.length}.sql`;
            const closing = Math.max(sql.lastIndexOf("]"), sql.lastIndexOf('"'));
            const offset = closing === sql.length - 1 ? closing : sql.length;
            await runtime.open(uri, 1, sql);
            const item = features
                .completion(uri, 1, offset)
                .items.find((candidate) => candidate.label === label);

            assert.ok(item, `${label} in ${sql}`);
            assert.equal(applyCompletion(sql, item), expected);
        }
    });
    // Hostile catalog spellings exercise the same recovery scanner for an incomplete schema,
    // object, and empty bracket pair; edits preserve delimiters and quote reserved object names.
    test("completes hostile quoted and reserved catalog identifiers", async () => {
        const { runtime, features } = createServices();
        const cases = [
            [
                "SELECT * FROM [My Schema].",
                "Order-Items",
                "SELECT * FROM [My Schema].[Order-Items]",
            ],
            [
                "SELECT * FROM [My Schema].[Ord",
                "Order-Items",
                "SELECT * FROM [My Schema].[Order-Items]",
            ],
            [
                "SELECT * FROM [My Schema].[]",
                "Order-Items",
                "SELECT * FROM [My Schema].[Order-Items]",
            ],
            ["SELECT * FROM [My Schema].s", "select", "SELECT * FROM [My Schema].[select]"],
        ] as const;

        for (const [sql, label, expected] of cases) {
            const uri = `file:///hostile-${sql.length}-${label}.sql`;
            const offset = sql.endsWith("]") ? sql.length - 1 : sql.length;
            await runtime.open(uri, 1, sql);
            const item = features
                .completion(uri, 1, offset)
                .items.find((entry) => entry.label === label);
            assert.ok(item, `${label} in ${sql}`);
            assert.equal(applyCompletion(sql, item), expected);
        }
    });
    // Verifies SELECT and INSERT column suggestions retain an existing pair of brackets.
    test("completes columns inside bracketed identifiers", async () => {
        const { runtime, features } = createServices();
        const selectSql = "SELECT [Or] FROM sales.Orders";
        const selectOffset = selectSql.indexOf("]");
        await runtime.open("file:///bracket-column.sql", 1, selectSql);
        const selectItem = features
            .completion("file:///bracket-column.sql", 1, selectOffset)
            .items.find((item) => item.label === "OrderId");
        assert.ok(selectItem);
        assert.equal(applyCompletion(selectSql, selectItem), "SELECT [OrderId] FROM sales.Orders");

        const insertSql = "INSERT INTO sales.Orders ([Cu]) VALUES (1)";
        const insertOffset = insertSql.indexOf("]");
        await runtime.open("file:///bracket-insert-column.sql", 1, insertSql);
        const insertItem = features
            .completion("file:///bracket-insert-column.sql", 1, insertOffset)
            .items.find((item) => item.label === "CustomerId");
        assert.ok(insertItem);
        assert.equal(
            applyCompletion(insertSql, insertItem),
            "INSERT INTO sales.Orders ([CustomerId]) VALUES (1)",
        );
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
    // Catalog hydration must not turn symbols from sibling statements into expression candidates.
    test("keeps hydrated catalog symbols within their query", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT 1 FROM dbo.Users AS priorAlias; SELECT pri;";
        await runtime.open("file:///scoped-catalog-symbols.sql", 1, sql);
        const items = features.completion(
            "file:///scoped-catalog-symbols.sql",
            1,
            sql.indexOf("pri;") + 3,
        ).items;
        assert.ok(!items.some((item) => item.label === "priorAlias"));
        assert.ok(!items.some((item) => item.label === "Id"));
        assert.ok(!items.some((item) => item.label === "Display Name"));
        assert.ok(!items.some((item) => item.label === "dbo.Users"));

        const valid = "SELECT curr FROM dbo.Users AS currentAlias;";
        await runtime.open("file:///scoped-catalog-alias.sql", 1, valid);
        assert.ok(
            features
                .completion(
                    "file:///scoped-catalog-alias.sql",
                    1,
                    valid.indexOf("curr FROM") + "curr".length,
                )
                .items.some((item) => item.kind === "alias" && item.label === "currentAlias"),
        );
    });
    // Verifies database, schema, and object qualification all use the same indexed catalog path.
    test("completes tables and views across databases without eager column loading", async () => {
        const { runtime, features } = createServices();
        const databaseSql = "SELECT * FROM Archive";
        await runtime.open("file:///cross-database.sql", 1, databaseSql);
        assert.ok(
            features
                .completion("file:///cross-database.sql", 1, databaseSql.length)
                .items.some((item) => item.kind === "database" && item.label === "ArchiveDb"),
        );

        const schemaSql = "SELECT * FROM ArchiveDb.";
        await runtime.open("file:///cross-schema.sql", 1, schemaSql);
        assert.ok(
            features
                .completion("file:///cross-schema.sql", 1, schemaSql.length)
                .items.some((item) => item.kind === "schema" && item.label === "history"),
        );

        const objectSql = "SELECT * FROM ArchiveDb.history.";
        await runtime.open("file:///cross-object.sql", 1, objectSql);
        const objects = features.completion("file:///cross-object.sql", 1, objectSql.length).items;
        assert.ok(objects.some((item) => item.kind === "table" && item.label === "Orders2024"));
        assert.ok(objects.some((item) => item.kind === "view" && item.label === "OrderSummary"));
    });
    // Verifies routine contexts do not incorrectly offer tables as executable objects.
    test("completes procedures in EXECUTE contexts", async () => {
        const { runtime, features } = createServices();
        const sql = "EXEC sales.";
        await runtime.open("file:///execute.sql", 1, sql);
        const items = features.completion("file:///execute.sql", 1, sql.length).items;

        assert.ok(items.some((item) => item.kind === "procedure" && item.label === "RebuildOrder"));
        assert.ok(!items.some((item) => item.kind === "table"));

        const parameterSql = "EXEC sales.RebuildOrder @Ord";
        await runtime.open("file:///execute-parameter.sql", 1, parameterSql);
        assert.ok(
            features
                .completion("file:///execute-parameter.sql", 1, parameterSql.length)
                .items.some((item) => item.kind === "parameter" && item.label === "@OrderId"),
        );
    });
    // Verifies security DDL receives principal-specific suggestions instead of generic identifiers.
    test("completes logins, users, and roles in security contexts", async () => {
        const { runtime, features } = createServices();
        const loginSql = "ALTER LOGIN App";
        await runtime.open("file:///login.sql", 1, loginSql);
        assert.ok(
            features
                .completion("file:///login.sql", 1, loginSql.length)
                .items.some((item) => item.kind === "login" && item.label === "AppLogin"),
        );

        const memberSql = "ALTER ROLE app_role ADD MEMBER Al";
        await runtime.open("file:///role.sql", 1, memberSql);
        const members = features.completion("file:///role.sql", 1, memberSql.length).items;
        assert.ok(members.some((item) => item.kind === "user" && item.label === "Alice"));
        assert.ok(!members.some((item) => item.kind === "login"));

        for (const [sql, kind, label] of [
            ["ALTER SERVER ROLE sy", "serverRole", "sysadmin"],
            ["CREATE USER new_user FOR LOGIN = App", "login", "AppLogin"],
            ["EXECUTE AS LOGIN = App", "login", "AppLogin"],
            ["EXECUTE AS USER = Al", "user", "Alice"],
            ["GRANT SELECT TO Al", "user", "Alice"],
        ] as const) {
            const uri = `file:///principal-${kind}-${sql.length}.sql`;
            await runtime.open(uri, 1, sql);
            assert.ok(
                features
                    .completion(uri, 1, sql.length)
                    .items.some((item) => item.kind === kind && item.label === label),
                sql,
            );
        }

        // SQL-looking text in another statement, comment, or literal is not a principal context.
        const unrelated = "SELECT 'ALTER LOGIN ' AS text_value; -- ALTER USER\nSELECT App";
        const unrelatedUri = "file:///not-a-principal-context.sql";
        await runtime.open(unrelatedUri, 1, unrelated);
        assert.ok(
            !features
                .completion(unrelatedUri, 1, unrelated.length)
                .items.some((item) => item.kind === "login" || item.kind === "user"),
        );
    });
    // User-defined alias, CLR, and table types use the same indexed catalog path as objects and
    // preserve the qualification required to produce executable declarations.
    test("completes user-defined data types across schemas and databases", async () => {
        const { runtime, features } = createServices();
        const localSql = "DECLARE @code Ord";
        await runtime.open("file:///local-type.sql", 1, localSql);
        assert.ok(
            features
                .completion("file:///local-type.sql", 1, localSql.length)
                .items.some((item) => item.kind === "type" && item.label === "OrderCode"),
        );

        const schemaSql = "DECLARE @rows dbo.";
        await runtime.open("file:///schema-type.sql", 1, schemaSql);
        assert.ok(
            features
                .completion("file:///schema-type.sql", 1, schemaSql.length)
                .items.some((item) => item.kind === "type" && item.label === "RowSet"),
        );

        const databaseSql = "CREATE PROCEDURE dbo.p @value ArchiveDb.history.";
        await runtime.open("file:///database-type.sql", 1, databaseSql);
        assert.ok(
            features
                .completion("file:///database-type.sql", 1, databaseSql.length)
                .items.some((item) => item.kind === "type" && item.label === "ArchiveCode"),
        );
    });
});
