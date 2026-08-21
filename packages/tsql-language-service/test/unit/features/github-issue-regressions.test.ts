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
    type MetadataHydrationRequest,
    type MetadataProvider,
} from "../../../src/index.ts";
import { classificationOf, colorize } from "../support/coloringHarness.ts";
import {
    applyCompletion,
    createCatalogFeatureServices,
    object,
} from "../support/catalogFeatureHarness.ts";

suite("GitHub issue language-feature regressions", () => {
    test("completes columns from a previously declared temp table (azuredatastudio#13814)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///temp-table-completion.sql";
        const sql = `
DROP TABLE IF EXISTS #EmployeeIDs;
CREATE TABLE #EmployeeIDs (EmployeeID varchar(25) NOT NULL);
SELECT ids. FROM #EmployeeIDs AS ids;
`;
        await runtime.open(uri, 1, sql);

        const labels = features
            .completion(uri, 1, sql.indexOf("ids. FROM") + "ids.".length)
            .items.map((item) => item.label);

        assert.ok(labels.includes("EmployeeID"));
    });

    test("offers objects from every schema without requiring a qualifier (vscode-mssql#893, #19615, #21883, #21930; azuredatastudio#108, #18514)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///cross-schema-completion.sql";
        const sql = "SELECT * FROM ";
        await runtime.open(uri, 1, sql);

        const labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);

        assert.ok(labels.includes("dbo.Users"));
        assert.ok(labels.includes("Orders"));
    });

    test("completes objects after an explicit non-default schema (vscode-mssql#522, #18451, #19615; azuredatastudio#18514)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///qualified-cross-schema-completion.sql";
        const sql = "SELECT * FROM dbo.";
        await runtime.open(uri, 1, sql);

        const labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);

        assert.ok(labels.includes("Users"));
    });

    test("completes three-part names in another database (azuredatastudio#17952)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///cross-database-completion.sql";
        const sql = "SELECT * FROM ArchiveDb.history.";
        await runtime.open(uri, 1, sql);

        const labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);

        assert.ok(labels.includes("Orders2024"));
        assert.ok(labels.includes("OrderSummary"));
    });

    test("completes schemas after another database name (azuredatastudio#17952)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///cross-database-schema-completion.sql";
        const sql = "SELECT * FROM ArchiveDb.";
        await runtime.open(uri, 1, sql);

        const labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);

        assert.ok(labels.includes("history"));
    });

    test("suppresses keyword completion while declaring aliases (vscode-mssql#21882, #22490; azuredatastudio#2034, #2552, #25693)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const cases = ["SELECT * FROM sales.Orders AS p", "SELECT * FROM sales.Orders mac"];

        for (const [index, sql] of cases.entries()) {
            const uri = `file:///alias-declaration-${index}.sql`;
            await runtime.open(uri, 1, sql);
            const labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);
            assert.ok(!labels.includes("PARTIAL"), sql);
            assert.ok(!labels.includes("NAMESPACE"), sql);
        }
    });

    test("quotes identifiers containing spaces or punctuation (vscode-mssql#1486)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const tableUri = "file:///quoted-table-completion.sql";
        const tableSql = "SELECT * FROM [My Schema].Ord";
        await runtime.open(tableUri, 1, tableSql);
        const table = features
            .completion(tableUri, 1, tableSql.length)
            .items.find((item) => item.label === "Order-Items");
        assert.ok(table);
        assert.equal(applyCompletion(tableSql, table), "SELECT * FROM [My Schema].[Order-Items]");

        const columnUri = "file:///quoted-column-completion.sql";
        const columnSql = "SELECT u.Disp FROM dbo.Users AS u;";
        const columnOffset = columnSql.indexOf("Disp") + "Disp".length;
        await runtime.open(columnUri, 1, columnSql);
        const column = features
            .completion(columnUri, 1, columnOffset)
            .items.find((item) => item.label === "Display Name");
        assert.ok(column);
        assert.equal(
            applyCompletion(columnSql, column),
            "SELECT u.[Display Name] FROM dbo.Users AS u;",
        );
    });

    test("offers columns from in-scope rowsets in WHERE and GROUP BY (azuredatastudio#1642, #19302)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const cases = [
            "SELECT * FROM dbo.Users AS u WHERE ",
            "SELECT * FROM dbo.Users AS u GROUP BY ",
        ];

        for (const [index, sql] of cases.entries()) {
            const uri = `file:///clause-column-completion-${index}.sql`;
            await runtime.open(uri, 1, sql);
            const labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);
            assert.ok(labels.includes("Id"), sql);
            assert.ok(labels.includes("Display Name"), sql);
        }
    });

    test("offers columns from in-scope rowsets in ORDER BY (azuredatastudio#1642, #19302)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///order-by-column-completion.sql";
        const sql = "SELECT * FROM dbo.Users AS u ORDER BY ";
        await runtime.open(uri, 1, sql);

        const labels = features.completion(uri, 1, sql.length).items.map((item) => item.label);
        assert.ok(labels.includes("Id"));
        assert.ok(labels.includes("Display Name"));
    });

    test("completes columns through table aliases (azuredatastudio#25154, #2552)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///alias-column-completion.sql";
        const sql = "SELECT u. FROM dbo.Users AS u;";
        const offset = sql.indexOf("u. FROM") + "u.".length;
        await runtime.open(uri, 1, sql);

        const labels = features.completion(uri, 1, offset).items.map((item) => item.label);

        assert.ok(labels.includes("Id"));
        assert.ok(labels.includes("Display Name"));
    });

    test("expands INSERT columns while omitting generated columns (vscode-mssql#19047; azuredatastudio#13880, #17624)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///insert-expansion.sql";
        const sql = "INSERT INTO sales.Orders";
        await runtime.open(uri, 1, sql);

        const expansion = features
            .completion(uri, 1, sql.length)
            .items.find((item) => item.label === "Expand INSERT columns and VALUES");

        assert.ok(expansion?.edit);
        assert.match(expansion.edit.newText, /\[CustomerId\]/u);
        assert.doesNotMatch(expansion.edit.newText, /OrderId|ComputedTotal/u);
    });

    test("inserts CURRENT_TIMESTAMP without parentheses (azuredatastudio#19229)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///keyword-function-completion.sql";
        const sql = "SELECT CURRENT_TI";
        await runtime.open(uri, 1, sql);

        const item = features
            .completion(uri, 1, sql.length)
            .items.find((candidate) => candidate.label === "CURRENT_TIMESTAMP");

        assert.ok(item);
        assert.equal(applyCompletion(sql, item), "SELECT CURRENT_TIMESTAMP");
    });

    test("resolves a table when its schema has the same name (vscode-mssql#21854, azuredatastudio#2181)", async () => {
        const metadata = new InMemoryMetadataProvider({
            environment: { currentDatabase: "ApplicationDb", defaultSchema: "dbo" },
            databases: [{ name: "ApplicationDb" }],
            schemas: [
                { database: "ApplicationDb", name: "dbo" },
                { database: "ApplicationDb", name: "Tasks" },
            ],
            objects: [object("tasks", "Tasks", "Tasks", "table", "ApplicationDb")],
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const uri = "file:///same-schema-table-name.sql";
        const sql = "SELECT * FROM Tasks.Tasks;";
        await runtime.open(uri, 1, sql);

        assert.deepEqual(features.definitionTarget(uri, 1, sql.lastIndexOf("Tasks") + 1).object, {
            database: "ApplicationDb",
            schema: "Tasks",
            name: "Tasks",
            kind: "table",
        });
    });

    test("keeps brackets inside strings from changing later coloring (vscode-mssql#17779)", async () => {
        const sql =
            "SELECT '[not].[an].[identifier]' AS Value; SELECT dbo.Items.Id FROM dbo.Items;";
        const { tokens } = await colorize(sql);

        assert.deepEqual(classificationOf(tokens, sql, "'[not].[an].[identifier]'"), {
            type: "string",
            modifiers: [],
        });
        assert.deepEqual(classificationOf(tokens, sql, "Items", 1), {
            type: "table",
            modifiers: [],
        });
    });

    test("offers common statement and clause keywords (vscode-mssql#1098, #17873, #284; azuredatastudio#606, #25762, #4026, #4925, #15893)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const cases = [
            ["UPD", "UPDATE"],
            ["SELECT TOP", "TOP"],
            ["SELECT * FROM dbo.Users ORDER", "ORDER"],
            ["SELECT * FROM dbo.Users ORDER BY Id DES", "DESC"],
            ["SELECT CAS", "CASE"],
        ] as const;

        for (const [index, [sql, expected]] of cases.entries()) {
            const uri = `file:///keyword-completion-${index}.sql`;
            await runtime.open(uri, 1, sql);
            assert.ok(
                features
                    .completion(uri, 1, sql.length)
                    .items.some(({ label }) => label === expected),
                `${expected} in ${sql}`,
            );
        }
    });

    test("offers common multiword T-SQL phrases (vscode-mssql#1100)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///phrase-completion.sql";
        const sql = "SEL";
        await runtime.open(uri, 1, sql);

        const item = features
            .completion(uri, 1, sql.length)
            .items.find(({ label }) => label === "SELECT DISTINCT");
        assert.ok(item);
        assert.equal(applyCompletion(sql, item), "SELECT DISTINCT");
    });

    test("offers databases while starting a FROM target (azuredatastudio#24632)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///database-discovery-completion.sql";
        const sql = "SELECT * FROM Arc";
        await runtime.open(uri, 1, sql);

        assert.ok(
            features
                .completion(uri, 1, sql.length)
                .items.some(({ label, kind }) => label === "ArchiveDb" && kind === "database"),
        );
    });

    test("offers built-in functions without identifier brackets (vscode-mssql#18546; azuredatastudio#1116, #25921, #7570, #8383, #8427)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const cases = ["DATEFROMPARTS", "ROW_NUMBER", "TRANSLATE"] as const;

        for (const [index, name] of cases.entries()) {
            const prefix = name.slice(0, 5);
            const sql = `SELECT ${prefix}`;
            const uri = `file:///function-completion-${index}.sql`;
            await runtime.open(uri, 1, sql);
            const item = features
                .completion(uri, 1, sql.length)
                .items.find(({ label }) => label === name);
            assert.ok(item, name);
            assert.doesNotMatch(applyCompletion(sql, item), /\[[A-Z_]+\]/u);
        }
    });

    test("places the snippet cursor inside function parentheses (vscode-mssql#21881; azuredatastudio#25757)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///function-snippet-cursor.sql";
        const sql = "SELECT DATEF";
        await runtime.open(uri, 1, sql);

        const item = features
            .completion(uri, 1, sql.length)
            .items.find(({ label }) => label === "DATEFROMPARTS");

        assert.ok(item?.edit);
        assert.equal(item.insertTextFormat, "snippet");
        assert.match(item.edit.newText, /\(\$\{1:[^}]+\}/u);
    });

    test("does not offer SQL completion inside comments (azuredatastudio#19225, #23460, #24716, #8727)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///comment-completion.sql";
        const sql = "SELECT 1;\n-- UPD";
        await runtime.open(uri, 1, sql);

        assert.deepEqual(features.completion(uri, 1, sql.length).items, []);
    });

    test("does not offer SQL completion inside string literals", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        for (const [index, sql] of ["SELECT 'FROM Us", "SELECT 'GETD"].entries()) {
            const uri = `file:///string-completion-${index}.sql`;
            await runtime.open(uri, 1, sql);

            assert.deepEqual(features.completion(uri, 1, sql.length).items, []);
        }
    });

    test("offers completion immediately after a closed block comment", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///after-comment-completion.sql";
        const sql = "SELECT * FROM dbo.Users WHERE /* done */";
        await runtime.open(uri, 1, sql);

        assert.ok(
            features.completion(uri, 1, sql.length).items.some(({ label }) => label === "Id"),
        );
    });

    test("preserves trailing punctuation when replacing a completion prefix (vscode-mssql#282)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///completion-punctuation.sql";
        const sql = "SEL;";
        const offset = sql.indexOf(";");
        await runtime.open(uri, 1, sql);
        const item = features
            .completion(uri, 1, offset)
            .items.find(({ label }) => label === "SELECT");

        assert.ok(item);
        assert.equal(applyCompletion(sql, item), "SELECT;");
    });

    test("completes bracketed, quoted, and reserved catalog names (vscode-mssql#366, #473, #474; azuredatastudio#806)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const cases = [
            ["SELECT * FROM [My Schema].[Ord]", "Order-Items"],
            ['SELECT * FROM "My Schema"."Ord"', "Order-Items"],
            ["SELECT * FROM [My Schema].sel", "select"],
        ] as const;

        for (const [index, [sql, expected]] of cases.entries()) {
            const uri = `file:///quoted-catalog-completion-${index}.sql`;
            const offset = sql.endsWith("]") || sql.endsWith('"') ? sql.length - 1 : sql.length;
            await runtime.open(uri, 1, sql);
            const item = features
                .completion(uri, 1, offset)
                .items.find(({ label }) => label === expected);
            assert.ok(item, expected);
            assert.match(applyCompletion(sql, item), /\[Order-Items\]|"Order-Items"|\[select\]/u);
        }
    });

    test("completes catalog views and user-defined types (azuredatastudio#11057, #20502)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const viewUri = "file:///view-completion.sql";
        const viewSql = "SELECT * FROM ArchiveDb.history.OrderS";
        await runtime.open(viewUri, 1, viewSql);
        assert.ok(
            features
                .completion(viewUri, 1, viewSql.length)
                .items.some(({ kind, label }) => kind === "view" && label === "OrderSummary"),
        );

        const typeUri = "file:///type-completion.sql";
        const typeSql = "DECLARE @code sales.Order";
        await runtime.open(typeUri, 1, typeSql);
        assert.ok(
            features
                .completion(typeUri, 1, typeSql.length)
                .items.some(({ kind, label }) => kind === "type" && label === "OrderCode"),
        );
    });

    test("offers table hints in WITH clauses (vscode-mssql#809)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///table-hint-completion.sql";
        const sql = "SELECT * FROM dbo.Users WITH (NO";
        await runtime.open(uri, 1, sql);

        assert.ok(
            features.completion(uri, 1, sql.length).items.some(({ label }) => label === "NOLOCK"),
        );
    });

    test("expands stored-procedure parameters when completing a procedure (vscode-mssql#21884; azuredatastudio#18951)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///procedure-template-completion.sql";
        const sql = "EXEC sales.Reb";
        await runtime.open(uri, 1, sql);

        const item = features
            .completion(uri, 1, sql.length)
            .items.find(({ label }) => label === "RebuildOrder");

        assert.ok(item?.edit);
        assert.equal(item.insertTextFormat, "snippet");
        assert.match(item.edit.newText, /@OrderId\s*=\s*\$\{1:/u);
    });

    test("hydrates only the selected procedure completion", async () => {
        const requests: MetadataHydrationRequest[] = [];
        const procedures = Array.from({ length: 50 }, (_value, index) =>
            object(`procedure-${index}`, "dbo", `Procedure${index}`, "procedure"),
        );
        const inner = new InMemoryMetadataProvider({
            environment: { currentDatabase: "CustomerDb", defaultSchema: "dbo" },
            databases: [{ name: "CustomerDb" }],
            schemas: [{ database: "CustomerDb", name: "dbo" }],
            objects: procedures,
            parameterStates: new Map(
                procedures.map((procedure) => [procedure.ref.id, { kind: "notLoaded" as const }]),
            ),
        });
        const metadata = recordingProvider(inner, requests);
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const uri = "file:///procedure-hydration-completion.sql";
        const sql = "EXEC Pro";
        await runtime.open(uri, 1, sql);

        const result = features.completion(uri, 1, sql.length);
        assert.equal(
            requests.filter((request) => request.section === "parameters").length,
            0,
            "listing procedures must not hydrate every matching object",
        );

        const selected = result.items.find(({ label }) => label === "Procedure17");
        assert.ok(selected);
        await features.resolveCompletion(selected);
        assert.deepEqual(
            requests.filter((request) => request.section === "parameters"),
            [
                {
                    section: "parameters",
                    object: procedures[17]!.ref,
                    priority: "interactive",
                    reason: "completion",
                },
            ],
        );
    });

    test("matches catalog names case-insensitively (azuredatastudio#144)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///case-insensitive-completion.sql";
        const sql = "SELECT * FROM dbo.use";
        await runtime.open(uri, 1, sql);

        assert.ok(
            features.completion(uri, 1, sql.length).items.some(({ label }) => label === "Users"),
        );
    });

    test("completes grouped columns after CRLF line endings (azuredatastudio#10916)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///crlf-group-completion.sql";
        const sql = "SELECT Id FROM dbo.Users\r\nGROUP BY I";
        await runtime.open(uri, 1, sql);

        assert.ok(
            features.completion(uri, 1, sql.length).items.some(({ label }) => label === "Id"),
        );
    });

    test("completes rowset columns in join predicates (azuredatastudio#11365)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///join-predicate-completion.sql";
        const sql = "SELECT * FROM dbo.Users AS u JOIN sales.Orders AS o ON u.I";
        await runtime.open(uri, 1, sql);

        assert.ok(
            features.completion(uri, 1, sql.length).items.some(({ label }) => label === "Id"),
        );
    });

    test("completes JOIN targets and predicates from foreign keys (vscode-mssql#1466)", async () => {
        const afterJoin = createCatalogFeatureServices();
        const joinUri = "file:///relationship-join-completion.sql";
        const joinSql = "SELECT * FROM dbo.Users AS u JOIN ";
        await afterJoin.runtime.open(joinUri, 1, joinSql);
        const join = afterJoin.features
            .completion(joinUri, 1, joinSql.length)
            .items.find(({ label }) => label.startsWith("Orders ON "));
        assert.ok(join?.edit);
        assert.match(join.edit.newText, /sales\.Orders ON Orders\.CustomerId = u\.Id/u);

        const afterOn = createCatalogFeatureServices();
        const onUri = "file:///relationship-on-completion.sql";
        const onSql = "SELECT * FROM dbo.Users AS u JOIN sales.Orders AS o ON ";
        await afterOn.runtime.open(onUri, 1, onSql);
        const condition = afterOn.features
            .completion(onUri, 1, onSql.length)
            .items.find(({ label }) => label === "o.CustomerId = u.Id");
        assert.ok(condition);
    });

    test("completes foreign-key joins in the referenced-table direction", async () => {
        const afterJoin = createCatalogFeatureServices();
        const joinUri = "file:///reverse-relationship-join-completion.sql";
        const joinSql = "SELECT * FROM sales.Orders AS o JOIN ";
        await afterJoin.runtime.open(joinUri, 1, joinSql);
        const join = afterJoin.features
            .completion(joinUri, 1, joinSql.length)
            .items.find(({ label }) => label.startsWith("Users ON "));
        assert.ok(join?.edit);
        assert.match(join.edit.newText, /dbo\.Users ON o\.CustomerId = Users\.Id/u);

        const afterOn = createCatalogFeatureServices();
        const onUri = "file:///reverse-relationship-on-completion.sql";
        const onSql = "SELECT * FROM sales.Orders AS o JOIN dbo.Users AS u ON ";
        await afterOn.runtime.open(onUri, 1, onSql);
        const condition = afterOn.features
            .completion(onUri, 1, onSql.length)
            .items.find(({ label }) => label === "o.CustomerId = u.Id");
        assert.ok(condition);
    });

    test("requests cold foreign-key metadata for known join sources", async () => {
        const requests: MetadataHydrationRequest[] = [];
        const users = object("users", "dbo", "Users", "table");
        const orders = object("orders", "sales", "Orders", "table");
        const inner = new InMemoryMetadataProvider({
            environment: { currentDatabase: "CustomerDb", defaultSchema: "dbo" },
            databases: [{ name: "CustomerDb" }],
            schemas: [
                { database: "CustomerDb", name: "dbo" },
                { database: "CustomerDb", name: "sales" },
            ],
            objects: [users, orders],
            columns: new Map([
                ["users", [{ name: "Id", typeDisplay: "int" }]],
                ["orders", [{ name: "CustomerId", typeDisplay: "int" }]],
            ]),
            foreignKeyStates: new Map([
                ["users", { kind: "notLoaded" }],
                ["orders", { kind: "notLoaded" }],
            ]),
        });
        const metadata = recordingProvider(inner, requests);
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const uri = "file:///cold-relationship-completion.sql";
        const sql = "SELECT * FROM sales.Orders AS o JOIN dbo.Users AS u ON ";
        await runtime.open(uri, 1, sql);

        const result = features.completion(uri, 1, sql.length);
        const constraintRequests = requests.filter(
            (request) => request.section === "constraints" && request.reason === "completion",
        );
        assert.equal(result.incomplete, true);
        assert.equal(constraintRequests.length, 2);
        assert.deepEqual(
            new Set(constraintRequests.map((request) => request.object?.id)),
            new Set(["orders", "users"]),
        );
    });

    test("offers MERGE as a statement keyword (vscode-mssql#18547)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///merge-completion.sql";
        const sql = "MER";
        await runtime.open(uri, 1, sql);

        assert.ok(
            features.completion(uri, 1, sql.length).items.some(({ label }) => label === "MERGE"),
        );
    });

    test("qualifies unscoped table completions with their schema (azuredatastudio#800)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///schema-qualified-table-completion.sql";
        const sql = "SELECT * FROM Use";
        await runtime.open(uri, 1, sql);

        const item = features
            .completion(uri, 1, sql.length)
            .items.find(({ label }) => label === "Users");

        assert.ok(item);
        assert.match(applyCompletion(sql, item), /FROM\s+(?:\[dbo\]|dbo)\.(?:\[Users\]|Users)$/u);
    });

    test("inserts global variables without function parentheses (azuredatastudio#9415)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///global-variable-completion.sql";
        const sql = "SELECT @@ServerNa";
        await runtime.open(uri, 1, sql);

        const item = features
            .completion(uri, 1, sql.length)
            .items.find(({ label }) => label.toUpperCase() === "@@SERVERNAME");

        assert.ok(item);
        assert.doesNotMatch(applyCompletion(sql, item), /@@SERVERNAME\(\)/iu);
    });

    test("offers MATCHED in MERGE branches (azuredatastudio#14573)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///merge-matched-completion.sql";
        const sql = `
MERGE INTO dbo.Users AS target
USING sales.Orders AS source ON target.Id = source.CustomerId
WHEN NOT M`;
        await runtime.open(uri, 1, sql);

        assert.ok(
            features.completion(uri, 1, sql.length).items.some(({ label }) => label === "MATCHED"),
        );
    });

    test("completes projected aliases from SELECT INTO temp tables (vscode-mssql#17721)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///select-into-alias-completion.sql";
        const sql = `
SELECT CAST(1 AS bit) AS N'This is a test' INTO #Test;
SELECT * FROM #Test WHERE #Test.`;
        await runtime.open(uri, 1, sql);

        assert.ok(
            features
                .completion(uri, 1, sql.length)
                .items.some(({ label }) => label === "This is a test"),
        );
    });
});

function recordingProvider(
    inner: InMemoryMetadataProvider,
    requests: MetadataHydrationRequest[],
): MetadataProvider {
    return {
        get id() {
            return inner.id;
        },
        pin: () => inner.pin(),
        requestHydration: (request) => requests.push(request),
        refresh: (signal) => inner.refresh(signal),
        onDidChange: (listener) => inner.onDidChange(listener),
    };
}
