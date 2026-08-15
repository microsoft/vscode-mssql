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

    // Verifies user catalog entries sort alphabetically before all system catalog entries.
    test("ranks user schemas and objects before system catalog entries", async () => {
        const { runtime, features } = createServices();
        const schemasSql = "SELECT * FROM ";
        await runtime.open("file:///schemas.sql", 1, schemasSql);
        const schemas = features.completion("file:///schemas.sql", 1, schemasSql.length).items;
        const sort = Object.fromEntries(schemas.map((item) => [item.label, item.sortText]));
        assert.match(sort.sales, /^10-/);
        assert.match(sort.dbo, /^10-/);
        assert.match(sort.reporting, /^10-/);
        assert.ok(sort.reporting < sort.sys);
        assert.match(sort.sys, /^90-/);
        assert.match(sort.db_accessadmin, /^90-/);
        assert.match(sort.CustomerDb, /^10-/);
        assert.match(sort.master, /^90-/);

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

    // An unqualified result outside the default schema inserts a valid two-part object name.
    test("schema-qualifies cross-schema object completion edits", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT * FROM Us";
        await runtime.open("file:///cross-schema-edit.sql", 1, sql);
        const item = features
            .completion("file:///cross-schema-edit.sql", 1, sql.length)
            .items.find((candidate) => candidate.label === "dbo.Users");

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
        ];

        for (const [sql, label, expected] of cases) {
            const uri = `file:///bracket-${label.replaceAll(".", "-")}.sql`;
            const offset = sql.lastIndexOf("[") + 1;
            await runtime.open(uri, 1, sql);
            const item = features
                .completion(uri, 1, offset)
                .items.find((candidate) => candidate.label === label);

            assert.ok(item, `${label} in ${sql}`);
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
        ];

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

    // Verifies catalog hover provides object kind, exact SQL types, nullability, and signatures.
    test("hovers catalog objects with lazily loaded details", async () => {
        const { runtime, features } = createServices();
        const tableSql = "SELECT * FROM dbo.Users;";
        await runtime.open("file:///table-hover.sql", 1, tableSql);
        const tableHover = features.hover(
            "file:///table-hover.sql",
            1,
            tableSql.indexOf("Users") + 2,
        );
        assert.match(tableHover.markdown, /\*\*table\*\*/);
        assert.match(tableHover.markdown, /Display Name.*nvarchar\(100\).*NULL/s);

        const columnSql = "SELECT Id FROM dbo.Users;";
        await runtime.open("file:///column-hover.sql", 1, columnSql);
        const columnHover = features.hover("file:///column-hover.sql", 1, columnSql.indexOf("Id"));
        assert.match(columnHover.markdown, /\*\*column\*\* `Id`/);
        assert.match(columnHover.markdown, /Type: `int NOT NULL`/);

        const procedureSql = "EXEC sales.RebuildOrder;";
        await runtime.open("file:///procedure-hover.sql", 1, procedureSql);
        const procedureHover = features.hover(
            "file:///procedure-hover.sql",
            1,
            procedureSql.indexOf("RebuildOrder") + 2,
        );
        assert.match(procedureHover.markdown, /\*\*procedure\*\*/);
        assert.match(procedureHover.markdown, /@OrderId int/);
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

    // Verifies Ctrl+Space can discover an earlier projection star from elsewhere in its query.
    test("offers SELECT star expansion for manual completion at the end of the query", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT * FROM dbo.Users";
        await runtime.open("file:///manual-star.sql", 1, sql);

        const result = features.completion("file:///manual-star.sql", 1, sql.length);
        const expansion = result.items.find((item) => item.label === "Expand SELECT *");

        assert.deepEqual(expansion.edit, {
            start: sql.indexOf("*"),
            end: sql.indexOf("*") + 1,
            newText: "[Id], [Display Name]",
        });
    });

    // Verifies function wildcards do not become column-list expansion edits.
    test("does not expand COUNT star during manual completion", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT COUNT(*) FROM dbo.Users";
        await runtime.open("file:///count-star.sql", 1, sql);

        const result = features.completion("file:///count-star.sql", 1, sql.length);

        assert.equal(
            result.items.some((item) => item.label === "Expand SELECT *"),
            false,
        );
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
        assert.match(expansion.edit.newText, /VALUES \(\n\s+\$\{1:NULL\}\n\);\$0$/);
    });

    // Verifies Ctrl+Space at the target's end offers INSERT expansion without a typing trigger.
    test("offers INSERT expansion for manual completion", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders";
        await runtime.open("file:///manual-insert.sql", 1, sql);

        const result = features.completion("file:///manual-insert.sql", 1, sql.length);

        assert.ok(result.items.some((item) => item.label === "Expand INSERT columns and VALUES"));
    });

    // Verifies Ctrl+Space inside an empty column list replaces both parentheses with the expansion.
    test("expands INSERT from inside empty parentheses", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders ()";
        const offset = sql.indexOf("(") + 1;
        await runtime.open("file:///empty-insert-list.sql", 1, sql);

        const result = features.completion("file:///empty-insert-list.sql", 1, offset);
        const expansion = result.items.find(
            (item) => item.label === "Expand INSERT columns and VALUES",
        );

        assert.ok(expansion);
        assert.equal(expansion.edit.start, offset);
        assert.equal(expansion.edit.end, sql.length);
        assert.match(expansion.edit.newText, /^\n/u);
        assert.match(expansion.edit.newText, /VALUES \(\n\s+\$\{1:NULL\}\n\);\$0$/u);
        assert.equal(expansion.filterText, "columns values");
        assert.equal(expansion.insertTextFormat, "snippet");
        assert.equal(expansion.preselect, true);
        assert.equal(expansion.command.command, "editor.action.triggerParameterHints");
    });

    // Verifies accepting expansion consumes an editor-created empty VALUES skeleton as one edit.
    test("replaces an empty INSERT columns and VALUES skeleton", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders (\n)\nVALUES (\n);";
        const offset = sql.indexOf("(") + 1;
        await runtime.open("file:///empty-insert-skeleton.sql", 1, sql);

        const expansion = features
            .completion("file:///empty-insert-skeleton.sql", 1, offset)
            .items.find((item) => item.label === "Expand INSERT columns and VALUES");

        assert.ok(expansion);
        assert.equal(expansion.edit.start, offset);
        assert.equal(expansion.edit.end, sql.length);
        assert.match(expansion.edit.newText, /\);\$0$/u);
    });

    // Verifies a real user-supplied column list is never replaced by the smart INSERT action.
    test("does not replace a populated INSERT column list", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders (CustomerId)";
        const offset = sql.indexOf("CustomerId") + 2;
        await runtime.open("file:///populated-insert-list.sql", 1, sql);

        const result = features.completion("file:///populated-insert-list.sql", 1, offset);

        assert.equal(
            result.items.some((item) => item.label === "Expand INSERT columns and VALUES"),
            false,
        );
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
        object("rebuild", "sales", "RebuildOrder", "procedure"),
        { ...object("sysobjects", "dbo", "sysobjects", "view"), system: true },
        object("archive-orders", "history", "Orders2024", "table", "ArchiveDb"),
        object("archive-summary", "history", "OrderSummary", "view", "ArchiveDb"),
        {
            ...object("order-code", "sales", "OrderCode", "type"),
            typeCategory: "alias",
        },
        { ...object("row-set", "dbo", "RowSet", "type"), typeCategory: "table" },
        {
            ...object("archive-code", "history", "ArchiveCode", "type", "ArchiveDb"),
            typeCategory: "clr",
        },
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
            { database: "ArchiveDb", name: "history" },
        ],
        databases: [{ name: "CustomerDb" }, { name: "ArchiveDb" }, { name: "master" }],
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
        parameters: new Map([["rebuild", [{ ordinal: 1, name: "@OrderId", typeDisplay: "int" }]]]),
        principals: [
            { id: "login:app", name: "AppLogin", kind: "login" },
            { id: "role:sysadmin", name: "sysadmin", kind: "serverRole", system: true },
            { id: "user:alice", database: "CustomerDb", name: "Alice", kind: "user" },
            {
                id: "role:app",
                database: "CustomerDb",
                name: "app_role",
                kind: "databaseRole",
            },
        ],
    });
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    return { runtime, features: new TsqlLanguageFeatureService(runtime, metadata) };
}

function object(id, schema, name, kind, database = "CustomerDb") {
    return {
        ref: { id, database },
        database,
        schema,
        name,
        kind,
    };
}

function applyCompletion(sql, item) {
    return `${sql.slice(0, item.edit.start)}${item.edit.newText}${sql.slice(item.edit.end)}`;
}
