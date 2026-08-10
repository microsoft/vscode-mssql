/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import type { SimpleExecuteResult } from "vscode-mssql";
import * as Constants from "../../../src/constants/constants";
import ConnectionManager, { ConnectionInfo } from "../../../src/controllers/connectionManager";
import {
    BetaSqlCodeLensProvider,
    BetaSqlCompletionProvider,
    type DatabaseObject,
    BetaSqlDefinitionProvider,
    BetaSqlDiagnostics,
    BetaSqlHoverProvider,
    BetaSqlMetadataCatalog,
    BetaSqlSessionManager,
    BetaSqlSignatureHelpProvider,
    synchronizeBetaSqlLanguageService,
} from "../../../src/languageservice/betaSqlCompletionProvider";
import SqlToolsServiceClient from "../../../src/languageservice/serviceclient";
import {
    betaSqlOwnsDocument,
    betaSqlOwnsDocumentUri,
    setLegacySqlDocumentOwnership,
} from "../../../src/languageservice/betaSqlLanguageServiceOwnership";
import { tsqlReservedKeywords } from "../../../src/languageservice/tsqlKeywords";
import { PreviewFeature, previewService } from "../../../src/previews/previewService";
import { ILogger } from "../../../src/sharedInterfaces/logger";
import { createStubLogger } from "../../unit/utils";

chai.use(sinonChai);

suite("BetaSqlCompletionProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let catalog: BetaSqlMetadataCatalog;
    let sessions: BetaSqlSessionManager;
    let provider: BetaSqlCompletionProvider;
    let previewEnabledStub: sinon.SinonStub;
    let testLogger: sinon.SinonStubbedInstance<ILogger>;

    const connectionId = "shared-connection-id";
    const databaseResult = singleColumnResult("master", "Warehouse");
    const schemaResult = singleColumnResult("db_accessadmin", "dbo", "sales", "sys");
    const jsonTempTableCompletionScript = `-- Purpose: Creates a runtime temp table with JSON data and queries parsed JSON fields.
-- Tags: sqlserver, json, temp-table, release-validation

-- Create a temp table with JSON column
CREATE TABLE #ProductsWithJson (
    ProductId INT,
    ProductName NVARCHAR(100),
    JsonData NVARCHAR(MAX)
);

-- Insert sample data with JSON
INSERT INTO #ProductsWithJson (ProductId, ProductName, JsonData)
VALUES
    (1, 'Laptop', '{"brand": "Dell", "specs": {"ram": "16GB", "storage": "512GB SSD", "processor": "Intel i7"}, "price": 1299.99, "inStock": true}'),
    (2, 'Mouse', '{"brand": "Logitech", "specs": {"type": "wireless", "buttons": 5, "dpi": 1600}, "price": 49.99, "inStock": true}'),
    (3, 'Monitor', '{"brand": "Samsung", "specs": {"size": "27 inch", "resolution": "2560x1440", "refreshRate": "144Hz"}, "price": 399.99, "inStock": false}'),
    (4, 'Keyboard', '{"brand": "Corsair", "specs": {"type": "mechanical", "switches": "Cherry MX Red", "backlight": "RGB"}, "price": 129.99, "inStock": true}');

-- Select all data with parsed JSON fields
SELECT
    ProductId,
    ProductName,
    JSON_VALUE(JsonData, '$.brand') AS Brand,
    JSON_VALUE(JsonData, '$.price') AS Price,
    JSON_VALUE(JsonData, '$.inStock') AS InStock,
    JSON_QUERY(JsonData, '$.specs') AS Specifications,
    JsonData AS RawJson
FROM #ProductsWithJson;

-- Query specific JSON properties
SELECT
    ProductId,
    ProductName,
    JSON_VALUE(JsonData, '$.brand') AS Brand,
    JSON_VALUE(JsonData, '$.specs.ram') AS RAM,
    JSON_VALUE(JsonData, '$.specs.storage') AS Storage,
    JSON_VALUE(JsonData, '$.specs.processor') AS Processor
FROM #ProductsWithJson
WHERE JSON_VALUE(JsonData, '$.specs.ram') IS NOT NULL;

-- Cleanup
DROP TABLE #ProductsWithJson;

select * from dbo.`;

    setup(() => {
        sandbox = sinon.createSandbox();
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        testLogger = createStubLogger(sandbox);
        connectionManager.getConnectionInfo.returns(connectionInfo(connectionId));
        previewEnabledStub = sandbox
            .stub(previewService, "isFeatureEnabled")
            .withArgs(PreviewFeature.BetaLanguageService)
            .returns(true);
        client.sendRequest.callsFake((_request, params) =>
            Promise.resolve(catalogResponse((params as { queryString: string }).queryString)),
        );
        catalog = new BetaSqlMetadataCatalog(client, testLogger);
        catalog.setOwnerUri(connectionId, "file:///metadata-owner.sql");
        sessions = new BetaSqlSessionManager(connectionManager, catalog);
        provider = new BetaSqlCompletionProvider(connectionManager, catalog, sessions);
    });

    teardown(() => {
        sessions.dispose();
        catalog.dispose();
        sandbox.restore();
    });

    /** Verifies that opting out disables both local parsing and remote catalog work. */
    test("does not provide completions when the preview is disabled", async () => {
        previewEnabledStub.returns(false);
        const document = await openSqlDocument("SELECT * FROM ");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items).to.be.empty;
        expect(client.sendRequest).to.not.have.been.called;
    });

    test("keeps notebook and SQLCMD documents on the legacy language service", () => {
        const ordinary = vscode.Uri.parse("file:///ordinary.sql");
        const notebook = vscode.Uri.parse("vscode-notebook-cell:///notebook.sql");

        expect(betaSqlOwnsDocument(ordinary)).to.equal(true);
        expect(betaSqlOwnsDocument(notebook)).to.equal(false);
        setLegacySqlDocumentOwnership(ordinary, true);
        expect(betaSqlOwnsDocument(ordinary)).to.equal(false);
        setLegacySqlDocumentOwnership(ordinary, false);
        expect(betaSqlOwnsDocument(ordinary)).to.equal(true);
    });

    test("does not parse Object Explorer owner keys as editor document URIs", async () => {
        const document = await openSqlDocument("SELECT 1");

        expect(betaSqlOwnsDocumentUri(document.uri.toString())).to.equal(true);
        expect(
            betaSqlOwnsDocumentUri("localhost,1433_Issue21930Repro_6d31c8a4_sa_release-validation"),
        ).to.equal(false);
    });

    test("recovers an outer completion from a damaged CTE projection", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const sql = "WITH x AS (SELECT 1 AS Id, t. FROM dbo.T AS t) " + "SELECT x. FROM x;";
        const document = await openSqlDocument(sql);
        const position = document.positionAt(sql.indexOf("x. FROM") + 2);

        const items = await provider.provideCompletionItems(document, position);

        expect(items.map((item) => item.label)).to.include("Id");
    });

    /** Verifies typing an explicit relation alias never opens the global keyword list. */
    test("suppresses completions while an explicit relation alias is being declared", async () => {
        for (const sql of [
            "SELECT * FROM sys.all_columns AS ",
            "SELECT * FROM sys.all_columns AS c",
        ]) {
            const document = await openSqlDocument(sql);

            const items = await provider.provideCompletionItems(document, endPosition(document));

            expect(items, sql).to.be.empty;
        }
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies package alias symbols suppress noise for aliases declared without AS. */
    test("suppresses completions on an implicit relation alias", async () => {
        const document = await openSqlDocument("SELECT * FROM dbo.Users u");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items).to.be.empty;
    });

    /** Verifies clause keywords return after the user finishes an alias and types a space. */
    test("restores clause completions after a completed relation alias", async () => {
        const document = await openSqlDocument("SELECT * FROM dbo.Users AS u ");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include("WHERE");
    });

    test("completes dbo objects without waiting for whole-document metadata", async () => {
        const getSession = sandbox.spy(sessions, "getSession");
        const document = await openSqlDocument(jsonTempTableCompletionScript);

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include.members(["Users", "GetUsers"]);
        const users = items.find((item) => labelOf(item) === "Users")!;
        const caret = endPosition(document);
        expect(users.filterText).to.equal("Users");
        expect(users.range).to.be.instanceOf(vscode.Range);
        expect(
            (users.range as vscode.Range).isEqual(new vscode.Range(caret, caret)),
            JSON.stringify({ range: users.range, caret }),
        ).to.equal(true);
        expect(getSession).to.not.have.been.called;
        expect(queryStrings(client)).to.satisfy(
            (queries: string[]) =>
                queries.some((query) => query.includes("SchemaName = N'dbo'")) &&
                queries.every(
                    (query) => !query.includes("ProductsWithJson") && !query.includes("JSON_VALUE"),
                ),
        );
    });

    test("delivers full-script dbo completion items through VS Code", async () => {
        const document = await openSqlDocument(jsonTempTableCompletionScript);
        const registration = vscode.languages.registerCompletionItemProvider(
            { language: "sql", scheme: document.uri.scheme },
            provider,
            ".",
        );

        try {
            const result = await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider",
                document.uri,
                endPosition(document),
                ".",
            );

            expect(result.items.map(labelOf)).to.include.members(["Users", "GetUsers"]);
        } finally {
            registration.dispose();
        }
    });

    /** Verifies that relation completion starts immediately and includes every catalog level. */
    test("loads bounded relation metadata for an empty object prefix", async () => {
        const document = await openSqlDocument("SELECT * FROM ");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const labels = items.map(labelOf);

        expect(labels).to.include.members([
            "Warehouse",
            "dbo",
            "sales",
            "dbo.Users",
            "sales.ActiveOrders",
            "dbo.GetUsers",
        ]);
        expect(labels).to.not.include.members(["dbo.CalculateTax", "dbo.ArchiveUsers"]);
        expect(queryStrings(client)).to.satisfy((queries: string[]) =>
            queries.some((query) => query.includes("SELECT TOP (201) SchemaName")),
        );
        expect(items.find((item) => labelOf(item) === "Warehouse")?.sortText).to.match(/^0_/);
        expect(items.find((item) => labelOf(item) === "master")?.sortText).to.match(/^1_/);
        expect(items.find((item) => labelOf(item) === "sys")?.sortText).to.match(/^1_/);
        expect(items.find((item) => labelOf(item) === "db_accessadmin")?.sortText).to.match(/^1_/);
        expect(items.find((item) => labelOf(item) === "dbo")?.sortText).to.match(/^0_/);
        expect(
            items.find((item) => labelOf(item) === "dbo")!.sortText! <
                items.find((item) => labelOf(item) === "db_accessadmin")!.sortText!,
        ).to.equal(true);
    });

    /** Verifies that a one-character prefix is enough to issue a bounded server-side search. */
    test("searches relations from the first typed character", async () => {
        const document = await openSqlDocument("SELECT * FROM U");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include("dbo.Users");
        expect(queryStrings(client)).to.satisfy((queries: string[]) =>
            queries.some(
                (query) =>
                    query.includes("TOP (201)") &&
                    query.includes("ObjectName LIKE N'U%'") &&
                    query.includes("ObjectType IN (N'table', N'view', N'tableValuedFunction')"),
            ),
        );
    });

    /** Verifies that large catalogs are capped before completion items reach the editor. */
    test("caps object suggestions at two hundred items", async () => {
        client.sendRequest.callsFake((_request, params) => {
            const query = (params as { queryString: string }).queryString;
            return Promise.resolve(
                query.includes("SELECT TOP (201) SchemaName")
                    ? objectSearchResult(
                          ...Array.from({ length: 205 }, (_, index) => ({
                              schema: "dbo",
                              name: `Table${index.toString().padStart(3, "0")}`,
                              type: "table" as const,
                          })),
                      )
                    : catalogResponse(query),
            );
        });
        const document = await openSqlDocument("SELECT * FROM T");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const tables = items.filter((item) => labelOf(item).startsWith("dbo.Table"));

        expect(tables).to.have.lengthOf(200);
    });

    /** Verifies that identical catalog searches share their in-flight and completed promise. */
    test("caches identical object searches per connection", async () => {
        await catalog.searchObjects(connectionId, { prefix: "Us", types: ["table"] });
        const callsAfterFirstSearch = client.sendRequest.callCount;

        await catalog.searchObjects(connectionId, { prefix: "Us", types: ["table"] });

        expect(client.sendRequest.callCount).to.equal(callsAfterFirstSearch);
    });

    /** Verifies that unrelated metadata requests run concurrently instead of blocking one another. */
    test("runs independent metadata fetches concurrently", async () => {
        let resolveDatabases!: (value: SimpleExecuteResult) => void;
        let resolveSchemas!: (value: SimpleExecuteResult) => void;
        const databases = new Promise<SimpleExecuteResult>((resolve) => {
            resolveDatabases = resolve;
        });
        const schemas = new Promise<SimpleExecuteResult>((resolve) => {
            resolveSchemas = resolve;
        });
        client.sendRequest.resetBehavior();
        client.sendRequest.onFirstCall().returns(databases);
        client.sendRequest.onSecondCall().returns(schemas);

        const databaseFetch = catalog.getDatabases(connectionId);
        const schemaFetch = catalog.getSchemas(connectionId);

        expect(client.sendRequest).to.have.callCount(2);
        resolveDatabases(databaseResult);
        resolveSchemas(schemaResult);
        await Promise.all([databaseFetch, schemaFetch]);
    });

    /** Verifies every system-catalog source uses NOLOCK to minimize metadata-read contention. */
    test("uses NOLOCK for every metadata catalog source", async () => {
        await catalog.getDatabases(connectionId);
        await catalog.getSchemas(connectionId, "Warehouse");
        await catalog.searchObjects(connectionId, { prefix: "Us", types: ["table"] });
        await catalog.createSchemaMapping(connectionId, [
            { schema: "dbo", name: "Users" },
            { schema: "dbo", name: "CalculateTax" },
        ]);

        const catalogSourceLines = queryStrings(client).flatMap((query) =>
            query.split(/\r?\n/).filter((line) => /\b(?:FROM|JOIN)\s+\S*sys\./i.test(line)),
        );

        expect(catalogSourceLines).to.not.be.empty;
        expect(catalogSourceLines).to.satisfy((lines: string[]) =>
            lines.every((line) => /\bWITH \(NOLOCK\)/i.test(line)),
        );
    });

    /** Verifies that table and routine metadata for a document are loaded in one batch query. */
    test("batches exact object and member metadata", async () => {
        const mapping = await catalog.createSchemaMapping(connectionId, [
            { schema: "dbo", name: "Users" },
            { schema: "dbo", name: "CalculateTax" },
        ]);

        expect(client.sendRequest).to.have.been.calledOnce;
        const query = queryStrings(client)[0];
        expect(query).to.include("WITH Requested(RequestKey, RequestedSchema, RequestedName)");
        expect(query).to.include("FROM sys.all_columns m");
        expect(query).to.include("FROM sys.all_parameters m");
        expect(query).to.include("SCHEMA_NAME()");
        expect(JSON.stringify(mapping)).to.include("UserId");
        expect(JSON.stringify(mapping)).to.include("@TaxRate");
    });

    /** Verifies local synonyms reuse target metadata returned by the same catalog query. */
    test("loads local synonym members without a follow-up query", async () => {
        const synonym = await catalog.getObject(connectionId, {
            schema: "dbo",
            name: "UserAlias",
        });

        expect(synonym?.type).to.equal("table");
        expect(await catalog.getMembers(connectionId, synonym!)).to.include("UserId");
        expect(client.sendRequest).to.have.been.calledOnce;
    });

    /** Verifies cross-database synonyms resolve members from their target database catalog. */
    test("resolves cross-database synonym metadata", async () => {
        const synonym = await catalog.getObject(connectionId, {
            schema: "dbo",
            name: "WarehouseUsers",
        });

        expect(synonym?.type).to.equal("table");
        expect(await catalog.getMembers(connectionId, synonym!)).to.include("UserId");
        expect(queryStrings(client)).to.satisfy((queries: string[]) =>
            queries.some((query) => query.includes("FROM [Warehouse].sys.all_columns m")),
        );
    });

    /** Verifies an unexecuted CREATE SYNONYM statement binds to its catalog-backed target. */
    test("completes relation synonyms declared in the current script", async () => {
        const sql =
            "CREATE SYNONYM dbo.CurrentUsers FOR dbo.Users; " +
            "SELECT currentUser. FROM dbo.CurrentUsers AS currentUser";
        const document = await openSqlDocument(sql);

        const items = await provider.provideCompletionItems(
            document,
            document.positionAt(sql.indexOf("currentUser.") + "currentUser.".length),
        );

        expect(items.map(labelOf)).to.include.members(["UserId", "Display Name"]);
    });

    /** Verifies that table-valued functions expose result columns while scalar routines expose parameters. */
    test("distinguishes table-valued and scalar function members", async () => {
        const tableFunction = await catalog.getObject(connectionId, {
            schema: "dbo",
            name: "GetUsers",
        });
        const scalarFunction = await catalog.getObject(connectionId, {
            schema: "dbo",
            name: "CalculateTax",
        });

        expect(tableFunction?.type).to.equal("tableValuedFunction");
        expect(await catalog.getMembers(connectionId, tableFunction!)).to.deep.equal([
            "UserId",
            "Display Name",
        ]);
        expect(scalarFunction?.type).to.equal("scalarFunction");
        expect(await catalog.getMembers(connectionId, scalarFunction!)).to.deep.equal([
            "@Amount",
            "@TaxRate",
        ]);
    });

    /** Verifies that SQL Server reserved keywords remain complete and duplicate-free. */
    test("suggests all SQL Server reserved keywords", async () => {
        const document = await openSqlDocument("");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const keywords = items
            .filter((item) => item.kind === vscode.CompletionItemKind.Keyword)
            .map(labelOf);

        expect(tsqlReservedKeywords).to.have.lengthOf(185);
        expect(new Set(tsqlReservedKeywords).size).to.equal(tsqlReservedKeywords.length);
        expect(keywords).to.include.members([...tsqlReservedKeywords]);
    });

    /** Verifies that local function completions replace only the prefix being typed. */
    test("suggests package functions with a precise replacement range", async () => {
        const document = await openSqlDocument("SELECT SUB");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const substring = items.find((item) => labelOf(item) === "substring");

        expect(substring?.kind).to.equal(vscode.CompletionItemKind.Function);
        expect(substring?.range).to.deep.equal(new vscode.Range(0, 7, 0, 10));
        expect(client.sendRequest).to.not.have.been.called;
    });

    for (const sql of [
        "select cast(6 as foo)",
        "select cast(6 as f",
        "select convert(foo, 6)",
        "select convert(f",
    ]) {
        /** Verifies every legacy CAST and CONVERT caret shape remains supported. */
        test(`suggests data types at the caret: ${sql}`, async () => {
            connectionManager.getConnectionInfo.returns(undefined);
            const document = await openSqlDocument(sql);

            const items = await provider.provideCompletionItems(
                document,
                document.positionAt(sql.indexOf("f") + 1),
            );

            expect(items.find((item) => labelOf(item) === "float")?.kind).to.equal(
                vscode.CompletionItemKind.TypeParameter,
            );
        });
    }

    /** Verifies CREATE TABLE begins with a reusable table skeleton and catalog namespaces. */
    test("suggests a table skeleton and namespaces after CREATE TABLE", async () => {
        const document = await openSqlDocument("CREATE TABLE ");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const labels = items.map(labelOf);

        expect(labels).to.include.members(["New table definition", "Warehouse", "dbo"]);
        expect(labels).to.not.include("dbo.Users");
        const template = items.find((item) => labelOf(item) === "New table definition");
        expect((template?.insertText as vscode.SnippetString | undefined)?.value).to.contain(
            "${1:TableName}",
        );
    });

    /** Verifies a new definition slot offers column and table-constraint snippets without metadata. */
    test("suggests CREATE TABLE definition snippets after an opening parenthesis", async () => {
        const document = await openSqlDocument("CREATE TABLE dbo.NewUsers (");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const labels = items.map(labelOf);

        expect(labels).to.include.members([
            "Column definition",
            "PRIMARY KEY constraint",
            "FOREIGN KEY constraint",
            "CHECK constraint",
            "CONSTRAINT",
        ]);
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies another definition slot gets the same structural completions after a top-level comma. */
    test("suggests CREATE TABLE definition snippets after a completed column", async () => {
        const document = await openSqlDocument("CREATE TABLE dbo.NewUsers (UserId int, ");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include.members([
            "Column definition",
            "PRIMARY KEY constraint",
        ]);
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies arbitrary column-name entry stays quiet instead of showing global SQL keywords. */
    test("suppresses completion noise while naming a CREATE TABLE column", async () => {
        const document = await openSqlDocument("CREATE TABLE dbo.NewUsers (Customer");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items).to.be.empty;
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies built-in SQL Server types are offered after a CREATE TABLE column name. */
    test("suggests data types for CREATE TABLE columns", async () => {
        const document = await openSqlDocument("CREATE TABLE dbo.NewUsers (CustomerId in");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const intItem = items.find((item) => labelOf(item) === "int");

        expect(intItem?.kind).to.equal(vscode.CompletionItemKind.TypeParameter);
        expect(intItem?.range).to.deep.equal(new vscode.Range(0, 38, 0, 40));
        expect(items.map(labelOf)).to.not.include("INSERT");
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies parameterized CREATE TABLE types insert an editable length placeholder. */
    test("inserts parameterized data type snippets for CREATE TABLE columns", async () => {
        const document = await openSqlDocument("CREATE TABLE dbo.NewUsers (DisplayName nvar");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const nvarchar = items.find((item) => labelOf(item) === "nvarchar");

        expect((nvarchar?.insertText as vscode.SnippetString | undefined)?.value).to.equal(
            "nvarchar(${1:50})",
        );
    });

    /** Verifies a type argument position offers useful SQL Server length choices. */
    test("suggests length values inside CREATE TABLE data types", async () => {
        const document = await openSqlDocument("CREATE TABLE dbo.NewUsers (DisplayName nvarchar(");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include.members(["MAX", "50", "100", "255"]);
        expect(items.every((item) => item.kind === vscode.CompletionItemKind.Value)).to.be.true;
    });

    /** Verifies completed column types transition to nullability, default, key, and identity options. */
    test("suggests CREATE TABLE column options after a data type", async () => {
        const document = await openSqlDocument("CREATE TABLE dbo.NewUsers (UserId int ");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const labels = items.map(labelOf);

        expect(labels).to.include.members([
            "NULL",
            "NOT NULL",
            "IDENTITY",
            "DEFAULT",
            "PRIMARY KEY",
            "REFERENCES",
            "CHECK",
        ]);
        const identity = items.find((item) => labelOf(item) === "IDENTITY");
        expect((identity?.insertText as vscode.SnippetString | undefined)?.value).to.equal(
            "IDENTITY(${1:1}, ${2:1})",
        );
        expect(labels).to.not.include("SELECT");
    });

    /** Verifies multi-token CREATE TABLE options continue with only their valid next keyword. */
    test("completes NULL and KEY continuations in CREATE TABLE definitions", async () => {
        for (const [sql, expected] of [
            ["CREATE TABLE dbo.NewUsers (UserId int NOT ", "NULL"],
            ["CREATE TABLE dbo.NewUsers (UserId int PRIMARY ", "KEY"],
        ]) {
            const document = await openSqlDocument(sql);
            const items = await provider.provideCompletionItems(document, endPosition(document));

            expect(items.map(labelOf), sql).to.deep.equal([expected]);
        }
    });

    /** Verifies a named table constraint offers the legal constraint families. */
    test("suggests constraint types after a CREATE TABLE constraint name", async () => {
        const document = await openSqlDocument(
            "CREATE TABLE dbo.NewUsers (UserId int, CONSTRAINT PK_NewUsers ",
        );

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include.members([
            "PRIMARY KEY",
            "FOREIGN KEY",
            "UNIQUE",
            "CHECK",
            "DEFAULT",
        ]);
    });

    /** Verifies table constraints complete only columns already declared in the new table. */
    test("suggests declared columns inside CREATE TABLE key constraints", async () => {
        const document = await openSqlDocument(
            "CREATE TABLE dbo.NewUsers (UserId int, TenantId int, CONSTRAINT PK_NewUsers PRIMARY KEY (UserId, ",
        );

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const labels = items.map(labelOf);

        expect(labels).to.include("TenantId");
        expect(labels).to.not.include("UserId");
        expect(items.find((item) => labelOf(item) === "TenantId")?.detail).to.equal("int");
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies REFERENCES table completion is restricted to catalog tables. */
    test("suggests referenced tables in CREATE TABLE foreign keys", async () => {
        const document = await openSqlDocument(
            "CREATE TABLE dbo.NewUsers (ManagerId int REFERENCES U",
        );

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const labels = items.map(labelOf);

        expect(labels).to.include("dbo.Users");
        expect(labels).to.not.include.members(["sales.ActiveOrders", "dbo.GetUsers"]);
    });

    /** Verifies REFERENCES column completion uses the referenced table's typed catalog members. */
    test("suggests referenced columns in CREATE TABLE foreign keys", async () => {
        const document = await openSqlDocument(
            "CREATE TABLE dbo.NewUsers (ManagerId int REFERENCES dbo.Users (",
        );

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const displayName = items.find((item) => labelOf(item) === "Display Name");

        expect(items.map(labelOf)).to.include.members(["UserId", "Display Name"]);
        expect(displayName?.detail).to.equal("nvarchar(100)");
        expect(displayName?.insertText).to.equal("[Display Name]");
    });

    /** Verifies CREATE TABLE can reference columns from an earlier local table while disconnected. */
    test("suggests locally declared referenced columns while disconnected", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument(
            "CREATE TABLE dbo.Parent (ParentId int, ParentName nvarchar(50)); " +
                "CREATE TABLE dbo.Child (ParentId int REFERENCES dbo.Parent (",
        );

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include.members(["ParentId", "ParentName"]);
        expect(items.find((item) => labelOf(item) === "ParentName")?.detail).to.equal(
            "nvarchar(50)",
        );
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies computed-column expressions can complete columns declared earlier in the table. */
    test("suggests local columns inside CREATE TABLE computed expressions", async () => {
        const document = await openSqlDocument(
            "CREATE TABLE dbo.Invoice (Quantity int, UnitPrice decimal(18,2), Total AS (",
        );

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include.members(["Quantity", "UnitPrice"]);
        expect(client.sendRequest).to.not.have.been.called;
    });

    for (const [alias, expected] of [
        ["N'This is a test'", "This is a test"],
        ["'This is a test'", "This is a test"],
        ["Thisisatest", "Thisisatest"],
        ['"This is a test"', "This is a test"],
        ["[This is a test]", "This is a test"],
        ["'This is a ''test'''", "This is a 'test'"],
        ['"This is a ""test"""', 'This is a "test"'],
        ["[This is a [test]]]", "This is a [test]"],
    ]) {
        /** Verifies SELECT INTO preserves aliases across supported T-SQL escaping styles. */
        test(`completes a SELECT INTO alias: ${alias}`, async () => {
            connectionManager.getConnectionInfo.returns(undefined);
            const sql = `SELECT CAST(1 AS bit) AS ${alias} INTO #Test
SELECT * FROM #Test WHERE #Test.`;
            const document = await openSqlDocument(sql);

            const items = await provider.provideCompletionItems(document, endPosition(document));

            expect(items.map(labelOf)).to.include(expected);
        });
    }

    /** Verifies CTEs are suggested without contacting the database. */
    test("suggests common table expressions in relation positions", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument(
            "WITH recent AS (SELECT 1 AS OrderId) SELECT * FROM rec",
        );

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const recent = items.find((item) => labelOf(item) === "recent");

        expect(recent?.kind).to.equal(vscode.CompletionItemKind.Reference);
        expect(recent?.range).to.deep.equal(new vscode.Range(0, 51, 0, 54));
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies metadata failures degrade to useful local keyword completions. */
    test("keeps keyword suggestions available when metadata fails", async () => {
        client.sendRequest.rejects(new Error("metadata unavailable"));
        const document = await openSqlDocument("SELECT * FROM SEL");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include("SELECT");
    });

    /** Verifies failure cooldown applies to one query without blocking other metadata kinds. */
    test("isolates metadata failure cooldowns by request", async () => {
        client.sendRequest.onFirstCall().rejects(new Error("database metadata unavailable"));
        client.sendRequest.onSecondCall().resolves(schemaResult);

        await expectMetadataFetchToFail(catalog.getDatabases(connectionId));
        const schemas = await catalog.getSchemas(connectionId);
        await expectMetadataFetchToFail(catalog.getDatabases(connectionId));

        expect(schemas).to.include("dbo");
        expect(client.sendRequest).to.have.callCount(2);
        expect(testLogger.error).to.have.been.calledWithMatch("Metadata fetch failed", {
            fetchType: "databases",
        });
    });

    /** Verifies each successful metadata request emits structured timing logs. */
    test("logs metadata request starts and completions", async () => {
        await catalog.getDatabases(connectionId);

        expect(testLogger.info).to.have.been.calledWithMatch("Metadata fetch started", {
            fetchType: "databases",
        });
        expect(testLogger.info).to.have.been.calledWithMatch("Metadata fetch completed", {
            fetchType: "databases",
            rowCount: databaseResult.rowCount,
        });
    });

    /** Verifies canceled callers return promptly while a shared catalog load can still finish. */
    test("cancels an in-flight session wait without corrupting its cache", async () => {
        let resolveBatch!: (value: SimpleExecuteResult) => void;
        const batch = new Promise<SimpleExecuteResult>((resolve) => {
            resolveBatch = resolve;
        });
        client.sendRequest.callsFake((_request, params) => {
            const query = (params as { queryString: string }).queryString;
            return query.includes("WITH Requested(RequestKey")
                ? batch
                : Promise.resolve(catalogResponse(query));
        });
        const document = await openSqlDocument("SELECT UserId FROM dbo.Users");
        const cancellation = new vscode.CancellationTokenSource();

        const pending = sessions.getSession(document, cancellation.token);
        cancellation.cancel();

        expect(await pending).to.be.undefined;
        resolveBatch(batchCatalogResult(queryStrings(client)[0]));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(await sessions.getSession(document)).to.not.be.undefined;
        cancellation.dispose();
    });

    /** Verifies delayed metadata cannot publish a superseded editor generation. */
    test("rejects a delayed metadata result after an offset-shifting edit", async () => {
        let resolveBatch!: (value: SimpleExecuteResult) => void;
        const batch = new Promise<SimpleExecuteResult>((resolve) => {
            resolveBatch = resolve;
        });
        client.sendRequest.callsFake((_request, params) => {
            const query = (params as { queryString: string }).queryString;
            return query.includes("WITH Requested(RequestKey")
                ? batch
                : Promise.resolve(catalogResponse(query));
        });
        const document = await openSqlDocument("SELECT UserId FROM dbo.Users");
        const oldVersion = document.version;
        const stale = sessions.getSession(document);

        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), "-- shifted\n");
        expect(await vscode.workspace.applyEdit(edit)).to.equal(true);
        expect(document.version).to.be.greaterThan(oldVersion);
        const current = sessions.getParsedSession(document);
        expect(current?.session.text).to.equal(document.getText());

        resolveBatch(batchCatalogResult(queryStrings(client)[0]));
        expect(await stale).to.be.undefined;
        expect(sessions.documents.get(document.uri.toString())?.version).to.equal(document.version);
        expect(sessions.documents.get(document.uri.toString())?.analysis.text).to.equal(
            document.getText(),
        );
    });

    /** Verifies every provider shares one parsed and metadata-enriched document session. */
    test("reuses a document session across completion and hover", async () => {
        const sql = "SELECT u.UserId FROM dbo.Users AS u";
        const document = await openSqlDocument(sql);
        const hoverProvider = new BetaSqlHoverProvider(connectionManager, catalog, sessions);

        await provider.provideCompletionItems(document, new vscode.Position(0, 8));
        const callsAfterCompletion = client.sendRequest.callCount;
        const hover = await hoverProvider.provideHover(
            document,
            new vscode.Position(0, sql.indexOf("UserId") + 1),
        );

        expect(hover).to.not.be.undefined;
        expect(client.sendRequest.callCount).to.equal(callsAfterCompletion);
    });

    /** Verifies edits reuse the package incremental session and already-cached metadata. */
    test("reuses cached schema metadata across document edits", async () => {
        const document = await openSqlDocument("SELECT UserId FROM dbo.Users");
        const first = await sessions.getSession(document);
        const callsAfterFirstVersion = client.sendRequest.callCount;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, endPosition(document), " ");
        expect(await vscode.workspace.applyEdit(edit)).to.be.true;

        const second = await sessions.getSession(document);

        expect(second?.session).to.not.equal(first?.session);
        expect(client.sendRequest.callCount).to.equal(callsAfterFirstVersion);
    });

    /** Verifies relation positions exclude scalar functions and stored procedures. */
    test("filters relation completions by object kind", async () => {
        const document = await openSqlDocument("SELECT * FROM dbo.");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const labels = items.map(labelOf);

        expect(labels).to.include.members(["Users", "GetUsers"]);
        expect(labels).to.not.include.members(["CalculateTax", "ArchiveUsers"]);
        expect(
            (items.find((item) => labelOf(item) === "GetUsers")?.insertText as vscode.SnippetString)
                .value,
        ).to.equal("GetUsers($0)");
    });

    /** Verifies EXEC completion searches only stored procedures. */
    test("suggests stored procedures after EXEC", async () => {
        const document = await openSqlDocument("EXEC dbo.Ar");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include("ArchiveUsers");
        expect(items.map(labelOf)).to.not.include.members(["Users", "CalculateTax"]);
        expect(items.find((item) => labelOf(item) === "ArchiveUsers")?.kind).to.equal(
            vscode.CompletionItemKind.Method,
        );
    });

    /** Verifies EXEC parameter completion omits parameters already assigned by name. */
    test("suggests only unused named procedure parameters", async () => {
        const document = await openSqlDocument("EXEC dbo.ArchiveUsers @UserId = 1, @F");

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.deep.equal(["@Force"]);
        expect(items[0].insertText).to.equal("@Force = ");
        expect(items[0].detail).to.equal("bit");
    });

    /** Verifies custom scalar functions provide typed parameter signature help. */
    test("provides catalog-backed scalar function signatures", async () => {
        const document = await openSqlDocument("SELECT dbo.CalculateTax(100, ");
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const help = await signatureProvider.provideSignatureHelp(document, endPosition(document));

        expect(help?.signatures[0].label).to.equal(
            "dbo.CalculateTax(@Amount decimal(10,2), @TaxRate decimal(5,4))",
        );
        expect(help?.activeParameter).to.equal(1);
    });

    /** Verifies a delayed catalog signature never publishes against a newer document version. */
    test("rejects delayed signature metadata after an editor change", async () => {
        let resolveObject!: (value: DatabaseObject | undefined) => void;
        const delayedObject = new Promise<DatabaseObject | undefined>((resolve) => {
            resolveObject = resolve;
        });
        sandbox.stub(catalog, "getObject").returns(delayedObject);
        const document = await openSqlDocument("SELECT dbo.CalculateTax(100, ");
        const version = document.version;
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const pending = signatureProvider.provideSignatureHelp(document, endPosition(document));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), "-- shifted\n");
        expect(await vscode.workspace.applyEdit(edit)).to.equal(true);
        expect(document.version).to.be.greaterThan(version);
        resolveObject({
            schema: "dbo",
            name: "CalculateTax",
            type: "scalarFunction",
        });

        expect(await pending).to.be.undefined;
    });

    /** Verifies nested custom calls keep signature help on the active outer function. */
    test("tracks nested custom function arguments", async () => {
        const document = await openSqlDocument(
            "SELECT dbo.CalculateTax(dbo.CalculateTax(100, 0.2), ",
        );
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const help = await signatureProvider.provideSignatureHelp(document, endPosition(document));

        expect(help?.signatures[0].label).to.equal(
            "dbo.CalculateTax(@Amount decimal(10,2), @TaxRate decimal(5,4))",
        );
        expect(help?.activeParameter).to.equal(1);
    });

    /** Verifies positional stored-procedure calls expose typed parameter help after commas. */
    test("provides signature help for positional EXEC arguments", async () => {
        const document = await openSqlDocument("EXEC dbo.ArchiveUsers 42, ");
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const help = await signatureProvider.provideSignatureHelp(document, endPosition(document));

        expect(help?.signatures[0].label).to.equal("dbo.ArchiveUsers @UserId int, @Force bit");
        expect(help?.activeParameter).to.equal(1);
    });

    /** Verifies built-in function signature help remains available without a connection. */
    test("provides built-in signatures offline", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument("SELECT COALESCE(");
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const help = await signatureProvider.provideSignatureHelp(document, endPosition(document));

        expect(help?.signatures[0].label).to.equal("COALESCE(expression, ...)");
    });

    /** Verifies VALUES signature help maps the active expression to its named target column and type. */
    test("provides typed signature help for INSERT VALUES", async () => {
        const document = await openSqlDocument(
            "INSERT INTO dbo.Users (UserId, [Display Name]) VALUES (1, ",
        );
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const help = await signatureProvider.provideSignatureHelp(document, endPosition(document));

        expect(help?.signatures[0].label).to.equal(
            "INSERT INTO dbo.Users VALUES (UserId int, [Display Name] nvarchar(100))",
        );
        expect(help?.activeParameter).to.equal(1);
        expect(help?.signatures[0].parameters?.[1].documentation).to.equal(
            "Column [Display Name] (nvarchar(100))",
        );
    });

    /** Verifies each row of a multi-row VALUES clause restarts column-position signature help. */
    test("tracks INSERT value positions across multiple rows", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument(
            "CREATE TABLE #Rows (RowId int, Note nvarchar(50)); " +
                "INSERT INTO #Rows (RowId, Note) VALUES (1, N'first'), (2, ",
        );
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const help = await signatureProvider.provideSignatureHelp(document, endPosition(document));

        expect(help?.signatures[0].label).to.equal(
            "INSERT INTO #Rows VALUES (RowId int, Note nvarchar(50))",
        );
        expect(help?.activeParameter).to.equal(1);
    });

    /** Verifies a nested function's parameter hints take priority over its enclosing VALUES row. */
    test("keeps function signature help active inside INSERT values", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument(
            "CREATE TABLE #Rows (RowId int); INSERT INTO #Rows (RowId) VALUES (COALESCE(",
        );
        const signatureProvider = new BetaSqlSignatureHelpProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const help = await signatureProvider.provideSignatureHelp(document, endPosition(document));

        expect(help?.signatures[0].label).to.equal("COALESCE(expression, ...)");
    });

    /** Verifies unsafe and reserved metadata identifiers are inserted with correct escaping. */
    test("quotes metadata identifiers and replaces incomplete bracketed prefixes", async () => {
        const document = await openSqlDocument("SELECT * FROM dbo.[Ord");
        const consoleError = sandbox.stub(console, "error");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const orderDetails = items.find((item) => labelOf(item) === "Order Details");

        expect(orderDetails?.insertText).to.equal("[Order Details]");
        expect(orderDetails?.range).to.deep.equal(new vscode.Range(0, 18, 0, 22));
        expect(consoleError).to.not.have.been.called;
    });

    /** Verifies closing brackets inside column names are escaped in insertion text. */
    test("escapes closing brackets in member insertions", async () => {
        const document = await openSqlDocument("SELECT u. FROM dbo.Users AS u");
        const session = await sessions.getSession(document);

        expect(
            session?.schema.columnsFor(["dbo", "Users"], "tsql")?.map((column) => column.name) ??
                [],
            `Queries: ${queryStrings(client).join("\n---\n")}`,
        ).to.include("SELECT]Value");

        const items = await provider.provideCompletionItems(
            document,
            new vscode.Position(0, "SELECT u.".length),
        );
        const escaped = items.find((item) => labelOf(item) === "SELECT]Value");

        expect(escaped, `Returned labels: ${items.map(labelOf).join(", ")}`).to.not.be.undefined;
        expect(escaped?.insertText).to.equal("[SELECT]]Value]");
    });

    /** Verifies double-quoted three-part identifiers select the requested database catalog. */
    test("supports double-quoted database and schema qualifiers", async () => {
        const document = await openSqlDocument('SELECT * FROM "Warehouse"."dbo".');

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include("Users");
        expect(queryStrings(client)).to.satisfy((queries: string[]) =>
            queries.some((query) => query.includes("FROM [Warehouse].sys.all_objects o")),
        );
    });

    /** Verifies four-part identifiers issue member queries through the linked-server catalog. */
    test("supports four-part linked-server member completion", async () => {
        const document = await openSqlDocument('SELECT "Remote"."Warehouse"."dbo"."Users".');

        const items = await provider.provideCompletionItems(document, endPosition(document));

        expect(items.map(labelOf)).to.include.members(["UserId", "Display Name"]);
        expect(queryStrings(client)).to.satisfy((queries: string[]) =>
            queries.some((query) => query.includes("FROM [Remote].[Warehouse].sys.all_columns m")),
        );
    });

    /** Verifies INSERT column completion uses one batch and removes columns already present. */
    test("suggests unused INSERT target columns", async () => {
        const sql = "INSERT INTO dbo.Users (UserId, )";
        const document = await openSqlDocument(sql);

        const items = await provider.provideCompletionItems(
            document,
            new vscode.Position(0, sql.indexOf(")")),
        );

        expect(items.map(labelOf)).to.include.members(["Display Name", "SELECT]Value"]);
        expect(items.map(labelOf)).to.not.include("UserId");
        expect(items.map(labelOf)).to.not.include("GeneratedId");
        expect(items.every((item) => item.kind === vscode.CompletionItemKind.Field)).to.be.true;
    });

    /** Verifies an INSERT target list can expand into all columns and editable VALUES placeholders. */
    test("expands INSERT columns and VALUES from catalog metadata", async () => {
        const document = await openSqlDocument("INSERT INTO dbo.Users (");

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const expansion = items.find(
            (item) => labelOf(item) === "Expand INSERT columns and VALUES",
        );

        expect(expansion?.kind).to.equal(vscode.CompletionItemKind.Snippet);
        expect((expansion?.insertText as vscode.SnippetString).value).to.equal(
            "\n    UserId,\n    [Display Name],\n    [SELECT]]Value]\n)\nVALUES (\n" +
                "    ${1:NULL},\n    ${2:NULL},\n    ${3:NULL}\n);$0",
        );
        expect(expansion?.range).to.deep.equal(
            new vscode.Range(endPosition(document), endPosition(document)),
        );
        expect(expansion?.command?.command).to.equal("editor.action.triggerParameterHints");
        expect(items.map(labelOf)).to.include.members(["UserId", "Display Name"]);
    });

    /** Verifies INSERT expansion uses parser-local temp-table metadata without a catalog request. */
    test("expands INSERT values for a locally declared temp table", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const sql = "CREATE TABLE #Rows (RowId int, Note nvarchar(50)); INSERT INTO #Rows (";
        const document = await openSqlDocument(sql);

        const items = await provider.provideCompletionItems(document, endPosition(document));
        const expansion = items.find(
            (item) => labelOf(item) === "Expand INSERT columns and VALUES",
        );

        expect((expansion?.insertText as vscode.SnippetString).value).to.include(
            "RowId,\n    Note",
        );
        expect(client.sendRequest).to.not.have.been.called;
    });

    /** Verifies a resolved SELECT wildcard expands to safely quoted catalog columns. */
    test("expands an unqualified SELECT wildcard", async () => {
        const sql = "SELECT * FROM dbo.Users AS u";
        const document = await openSqlDocument(sql);
        const position = document.positionAt(sql.indexOf("*") + 1);

        const items = await provider.provideCompletionItems(document, position);
        const expansion = items.find((item) => labelOf(item) === "Expand * to columns");

        expect(expansion?.kind).to.equal(vscode.CompletionItemKind.Snippet);
        expect(expansion?.insertText).to.equal(
            "UserId,\n       [Display Name],\n       [SELECT]]Value],\n       GeneratedId",
        );
        expect(document.getText(expansion?.range as vscode.Range)).to.equal("*");
    });

    /** Verifies a qualified wildcard keeps its source qualifier on every expanded column. */
    test("expands a qualified SELECT wildcard", async () => {
        const sql = "SELECT u.* FROM dbo.Users AS u";
        const document = await openSqlDocument(sql);
        const position = document.positionAt(sql.indexOf("*") + 1);

        const items = await provider.provideCompletionItems(document, position);
        const expansion = items.find((item) => labelOf(item) === "Expand * to columns");

        expect(expansion?.insertText).to.equal(
            "u.UserId,\n       u.[Display Name],\n       u.[SELECT]]Value],\n       u.GeneratedId",
        );
        expect(document.getText(expansion?.range as vscode.Range)).to.equal("u.*");
    });

    /** Verifies CREATE TABLE temp objects expose declared names and types to later statements. */
    test("completes locally declared temp-table columns", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const sql =
            "CREATE TABLE #Users ([User Id] int NOT NULL, Name nvarchar(20)); " +
            "SELECT u. FROM #Users AS u";
        const document = await openSqlDocument(sql);
        const position = document.positionAt(sql.indexOf("u.") + 2);

        const items = await provider.provideCompletionItems(document, position);

        expect(items.map(labelOf)).to.include.members(["User Id", "Name"]);
    });

    /** Verifies DECLARE TABLE variables participate in completion like regular relations. */
    test("completes locally declared table-variable columns", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const sql = "DECLARE @Users TABLE (UserId int, Name nvarchar(20)); SELECT u. FROM @Users u";
        const document = await openSqlDocument(sql);

        const items = await provider.provideCompletionItems(
            document,
            document.positionAt(sql.indexOf("u.") + 2),
        );

        expect(items.map(labelOf)).to.include.members(["UserId", "Name"]);
    });

    /** Verifies regular CREATE TABLE declarations contribute editor-local column metadata. */
    test("completes columns from a table declared earlier in the script", async () => {
        const sql =
            "CREATE TABLE dbo.LocalUsers (LocalId int, LocalName nvarchar(20)); " +
            "SELECT local. FROM dbo.LocalUsers AS local";
        const document = await openSqlDocument(sql);

        const items = await provider.provideCompletionItems(
            document,
            document.positionAt(sql.indexOf("local.") + "local.".length),
        );

        expect(items.map(labelOf)).to.include.members(["LocalId", "LocalName"]);
    });

    /** Verifies SELECT star INTO inherits source columns from live catalog metadata. */
    test("propagates source columns through SELECT star INTO", async () => {
        const sql = "SELECT * INTO #Copy FROM dbo.Users; " + "SELECT copy. FROM #Copy AS copy";
        const document = await openSqlDocument(sql);
        const session = await sessions.getSession(document);

        const items = await provider.provideCompletionItems(
            document,
            document.positionAt(sql.indexOf("copy.") + "copy.".length),
        );

        expect(
            session?.schema.columnsFor(["#Copy"], "tsql"),
            `Known tables: ${session?.schema.tables("tsql").join(", ")}`,
        ).to.not.be.undefined;
        expect(items.map(labelOf)).to.include.members(["UserId", "Display Name"]);
    });

    /** Verifies hover displays the catalog-derived type of a qualified column. */
    test("shows schema-derived column types on hover", async () => {
        const sql = "SELECT u.UserId FROM dbo.Users AS u";
        const document = await openSqlDocument(sql);
        const hoverProvider = new BetaSqlHoverProvider(connectionManager, catalog, sessions);

        const hover = await hoverProvider.provideHover(
            document,
            new vscode.Position(0, sql.indexOf("UserId") + 1),
        );

        expect((hover?.contents[0] as vscode.MarkdownString).value).to.contain("u.UserId: int");
    });

    /** Verifies relation hover distinguishes the catalog's actual SQL object kind. */
    test("shows catalog object types and aliases on hover", async () => {
        const sql = "SELECT u.UserId FROM dbo.Users AS u";
        const document = await openSqlDocument(sql);
        const hoverProvider = new BetaSqlHoverProvider(connectionManager, catalog, sessions);
        const objectStart = sql.indexOf("Users");

        const hover = await hoverProvider.provideHover(
            document,
            document.positionAt(objectStart + 1),
        );

        const contents = (hover?.contents[0] as vscode.MarkdownString).value;
        expect(contents).to.contain("dbo.Users");
        expect(contents).to.contain("**Object type:** Table");
        expect(contents).to.contain("**Alias:** u");
        expect(hover?.range).to.deep.equal(
            new vscode.Range(
                document.positionAt(objectStart),
                document.positionAt(objectStart + "Users".length),
            ),
        );
    });

    test("shows schema hover for an XML method receiver omitted by parser symbols", async () => {
        const sql =
            "SELECT u.UserId FROM dbo.Users AS u " +
            "CROSS APPLY u.UserId.nodes('/Root/Item') AS x(n)";
        const document = await openSqlDocument(sql);
        const receiver = sql.lastIndexOf("UserId");
        const hoverProvider = new BetaSqlHoverProvider(connectionManager, catalog, sessions);

        const hover = await hoverProvider.provideHover(
            document,
            new vscode.Position(0, receiver + 2),
        );

        expect((hover?.contents[0] as vscode.MarkdownString).value).to.contain("u.UserId: int");
    });

    /** Verifies definition navigation resolves an in-document CTE declaration. */
    test("navigates references to CTE definitions", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const sql = "WITH recent AS (SELECT 1 AS Id) SELECT Id FROM recent";
        const document = await openSqlDocument(sql);
        const definitionProvider = new BetaSqlDefinitionProvider(
            connectionManager,
            catalog,
            sessions,
        );

        const definition = await definitionProvider.provideDefinition(
            document,
            new vscode.Position(0, sql.lastIndexOf("recent") + 1),
        );

        expect(definition).to.be.instanceOf(vscode.Location);
        expect((definition as vscode.Location).range).to.deep.equal(new vscode.Range(0, 5, 0, 11));
    });

    /** Verifies complete catalog metadata enables semantic unknown-column diagnostics. */
    test("publishes semantic diagnostics when metadata is complete", async () => {
        const document = await openSqlDocument("SELECT MissingColumn FROM dbo.Users");
        const collection = vscode.languages.createDiagnosticCollection("mssql-beta-semantic-test");
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)?.map((diagnostic) => diagnostic.message)).to.include(
            "Invalid column name 'MissingColumn'.",
        );
        diagnostics.dispose();
    });

    /** Verifies metadata-independent FROM-name collisions remain visible while disconnected. */
    test("publishes duplicate exposed-name diagnostics without metadata", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument(
            "SELECT * FROM dbo.DummyData CROSS JOIN dbo.DummyData",
        );
        const collection = vscode.languages.createDiagnosticCollection(
            "mssql-beta-source-name-test",
        );
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)?.map((diagnostic) => diagnostic.message)).to.include(
            "The objects 'dbo.DummyData' and 'dbo.DummyData' in the FROM clause have the same exposed names. Use correlation names to distinguish them.",
        );
        diagnostics.dispose();
    });

    /** Verifies undeclared local variables are diagnosed without a database connection. */
    test("publishes variable diagnostics without metadata", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument("SELECT @missing + 1");
        const collection = vscode.languages.createDiagnosticCollection(
            "mssql-beta-variable-diagnostic-test",
        );
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)?.map((diagnostic) => diagnostic.message)).to.include(
            'Must declare the scalar variable "@missing".',
        );
        diagnostics.dispose();
    });

    /** Verifies structural INSERT diagnostics are published without catalog metadata. */
    test("publishes structural DML diagnostics without metadata", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument("INSERT INTO dbo.T (a, b) VALUES (1)");
        const collection = vscode.languages.createDiagnosticCollection(
            "mssql-beta-structural-diagnostic-test",
        );
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)?.map((diagnostic) => diagnostic.message)).to.include(
            "There are more columns in the INSERT statement than values specified in the VALUES clause. The number of values in the VALUES clause must match the number of columns specified in the INSERT statement.",
        );
        diagnostics.dispose();
    });

    /** Verifies recursive CTE references do not surface a closed-catalog false positive. */
    test("suppresses false unknown-table diagnostics for recursive CTEs", async () => {
        const document = await openSqlDocument(
            "WITH numbers AS (SELECT 1 AS value UNION ALL " +
                "SELECT value + 1 FROM numbers WHERE value < 10) SELECT value FROM numbers",
        );
        const collection = vscode.languages.createDiagnosticCollection(
            "mssql-beta-recursive-cte-test",
        );
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)).to.be.empty;
        diagnostics.dispose();
    });

    /** Verifies table-variable aliases remain bound inside derived tables with a closed schema. */
    test("binds table-variable aliases inside derived tables", async () => {
        const document = await openSqlDocument(
            "DECLARE @Rows TABLE (RowId int); " +
                "SELECT derived.RowId FROM (SELECT * FROM @Rows AS source) AS derived",
        );
        const collection = vscode.languages.createDiagnosticCollection(
            "mssql-beta-derived-table-variable-test",
        );
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)).to.be.empty;
        diagnostics.dispose();
    });

    /** Verifies unavailable metadata never creates false unknown-object or unknown-column errors. */
    test("suppresses semantic diagnostics when metadata is unavailable", async () => {
        client.sendRequest.rejects(new Error("metadata unavailable"));
        const document = await openSqlDocument("SELECT MissingColumn FROM dbo.Users");
        const collection = vscode.languages.createDiagnosticCollection("mssql-beta-offline-test");
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)).to.be.empty;
        diagnostics.dispose();
    });

    /** Verifies expected end-of-input parser noise is hidden while the user is typing. */
    test("suppresses incomplete syntax diagnostics at end of file", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument("SELECT 1 WHERE");
        const collection = vscode.languages.createDiagnosticCollection("mssql-beta-eof-test");
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)).to.be.empty;
        diagnostics.dispose();
    });

    /** Verifies real syntax errors away from the caret remain visible. */
    test("publishes stable syntax diagnostics away from end of file", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = await openSqlDocument("SELECT FROM; SELECT 1");
        const collection = vscode.languages.createDiagnosticCollection("mssql-beta-syntax-test");
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        expect(collection.get(document.uri)).to.not.be.empty;
        diagnostics.dispose();
    });

    /** Verifies raw ANTLR expectation dumps use the wording and token range of SQL Parser. */
    test("formats parser diagnostics using SQL Parser wording", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const sql = "select * from sys.all_columns from sys.all_columns";
        const document = await openSqlDocument(sql);
        const collection = vscode.languages.createDiagnosticCollection(
            "mssql-beta-parser-wording-test",
        );
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );

        await diagnostics.update(document);

        const published = collection.get(document.uri) ?? [];
        expect(published).to.have.lengthOf(1);
        expect(published[0].message).to.equal("Incorrect syntax near 'from'.");
        expect(published[0].source).to.equal("vscode-mssql");
        expect(published[0].code).to.equal("syntax");
        expect(published[0].range).to.deep.equal(new vscode.Range(0, 30, 0, 34));
        diagnostics.dispose();
    });

    /** Verifies rapid editor changes collapse into one diagnostics update. */
    test("debounces diagnostics while a document is changing", async () => {
        const document = await openSqlDocument("SELECT 1");
        const collection = vscode.languages.createDiagnosticCollection("mssql-beta-debounce-test");
        const diagnostics = new BetaSqlDiagnostics(
            connectionManager,
            catalog,
            collection,
            sessions,
        );
        const update = sandbox.stub(diagnostics, "update").resolves();

        diagnostics.schedule(document, 0);
        diagnostics.schedule(document, 0);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(update).to.have.been.calledOnceWith(document);
        diagnostics.dispose();
    });

    /** Verifies a manual refresh invalidates every cache for the active connection. */
    test("refresh clears shared metadata for the connected source", async () => {
        const document = await openSqlDocument("SELECT 1");
        const codeLensProvider = new BetaSqlCodeLensProvider(connectionManager, catalog);
        await Promise.all([catalog.getDatabases(connectionId), catalog.getSchemas(connectionId)]);
        const callsBeforeRefresh = client.sendRequest.callCount;

        codeLensProvider.refresh(document.uri);
        await Promise.all([catalog.getDatabases(connectionId), catalog.getSchemas(connectionId)]);

        expect(client.sendRequest.callCount).to.equal(callsBeforeRefresh + 2);
        codeLensProvider.dispose();
    });

    /** Verifies CodeLens accurately reflects idle, loading, ready, and failed catalog states. */
    test("reports metadata status through CodeLens", async () => {
        const document = await openSqlDocument("SELECT 1");
        const codeLensProvider = new BetaSqlCodeLensProvider(connectionManager, catalog);
        expect(codeLensTitle(codeLensProvider, document)).to.match(/connected/i);
        let resolveFetch!: (value: SimpleExecuteResult) => void;
        client.sendRequest.resetBehavior();
        client.sendRequest.onFirstCall().returns(
            new Promise<SimpleExecuteResult>((resolve) => {
                resolveFetch = resolve;
            }),
        );

        const pending = catalog.getDatabases(connectionId);
        expect(codeLensTitle(codeLensProvider, document)).to.match(/loading/i);
        resolveFetch(databaseResult);
        await pending;
        expect(codeLensTitle(codeLensProvider, document)).to.match(/ready/i);

        catalog.clear(connectionId);
        catalog.setOwnerUri(connectionId, document.uri.toString());
        client.sendRequest.rejects(new Error("metadata unavailable"));
        await expectMetadataFetchToFail(catalog.getDatabases(connectionId));
        expect(codeLensTitle(codeLensProvider, document)).to.match(/refresh/i);
        codeLensProvider.dispose();
    });

    /** Verifies beta enablement switches every SQL editor away from the legacy language service. */
    test("synchronizes connected and disconnected SQL documents", async () => {
        const document = await openSqlDocument("SELECT 1");

        synchronizeBetaSqlLanguageService(connectionManager);

        expect(connectionManager.setLanguageServiceForFile).to.have.been.calledWith(
            document.uri.toString(),
            Constants.noneProviderName,
        );

        previewEnabledStub.returns(false);
        synchronizeBetaSqlLanguageService(connectionManager);
        expect(connectionManager.setLanguageServiceForFile).to.have.been.calledWith(
            document.uri.toString(),
            Constants.mssqlProviderName,
        );
    });
});

interface CatalogObjectFixture {
    schema: string;
    name: string;
    type: "table" | "view" | "scalarFunction" | "tableValuedFunction" | "storedProcedure";
    /** name, SQL type, insertable, nullable */
    members?: Array<[string, string, boolean?, boolean?]>;
    baseObject?: string;
}

const catalogObjects: CatalogObjectFixture[] = [
    {
        schema: "dbo",
        name: "Users",
        type: "table",
        members: [
            ["UserId", "int"],
            ["Display Name", "nvarchar(100)"],
            ["SELECT]Value", "int"],
            ["GeneratedId", "int", false],
        ],
    },
    {
        schema: "dbo",
        name: "UserAlias",
        type: "table",
        baseObject: "[dbo].[Users]",
        members: [["UserId", "int"]],
    },
    {
        schema: "dbo",
        name: "WarehouseUsers",
        type: "table",
        baseObject: "[Warehouse].[dbo].[Users]",
    },
    {
        schema: "sales",
        name: "ActiveOrders",
        type: "view",
        members: [["OrderId", "int"]],
    },
    {
        schema: "dbo",
        name: "GetUsers",
        type: "tableValuedFunction",
        members: [
            ["UserId", "int"],
            ["Display Name", "nvarchar(100)"],
        ],
    },
    {
        schema: "dbo",
        name: "CalculateTax",
        type: "scalarFunction",
        members: [
            ["@Amount", "decimal(10,2)"],
            ["@TaxRate", "decimal(5,4)"],
        ],
    },
    {
        schema: "dbo",
        name: "ArchiveUsers",
        type: "storedProcedure",
        members: [
            ["@UserId", "int"],
            ["@Force", "bit"],
        ],
    },
    { schema: "dbo", name: "Order Details", type: "table", members: [["Order Id", "int"]] },
    { schema: "dbo", name: "SELECT", type: "table", members: [["Value", "int"]] },
    {
        schema: "sys",
        name: "objects",
        type: "view",
        members: [
            ["object_id", "int"],
            ["name", "sysname"],
            ["type_desc", "nvarchar(60)"],
        ],
    },
];

function catalogResponse(queryString: string): SimpleExecuteResult {
    if (queryString.includes("WITH Requested(RequestKey")) {
        return batchCatalogResult(queryString);
    }
    if (queryString.includes("SELECT name\nFROM sys.databases")) {
        return singleColumnResult("master", "Warehouse");
    }
    if (queryString.includes("SELECT name\nFROM") && queryString.includes("sys.schemas")) {
        return singleColumnResult("db_accessadmin", "dbo", "sales", "sys");
    }
    if (queryString.includes("SELECT TOP (201) SchemaName")) {
        return searchCatalogResult(queryString);
    }
    return emptyResult();
}

function searchCatalogResult(queryString: string): SimpleExecuteResult {
    const schema = /SchemaName = N'((?:''|[^'])*)'/.exec(queryString)?.[1]?.replaceAll("''", "'");
    const encodedPrefix = /ObjectName LIKE N'((?:''|[^'])*)%'/.exec(queryString)?.[1] ?? "";
    const prefix = encodedPrefix
        .replaceAll("~[", "[")
        .replaceAll("~_", "_")
        .replaceAll("~%", "%")
        .replaceAll("~~", "~")
        .replaceAll("''", "'");
    return objectSearchResult(
        ...catalogObjects.filter(
            (object) =>
                (!schema || object.schema.toLowerCase() === schema.toLowerCase()) &&
                (!prefix || object.name.toLowerCase().startsWith(prefix.toLowerCase())),
        ),
    );
}

function batchCatalogResult(queryString: string): SimpleExecuteResult {
    const requests = [
        ...queryString.matchAll(
            /\(N'([^']*)',\s*(?:N'([^']*)'|CAST\(NULL AS nvarchar\(128\)\)),\s*N'([^']*)'\)/g,
        ),
    ];
    const rows: SimpleExecuteResult["rows"] = [];
    for (const request of requests) {
        const [, requestKey, requestedSchema, requestedName] = request;
        const object = catalogObjects.find(
            (candidate) =>
                candidate.name.toLowerCase() === requestedName.toLowerCase() &&
                (!requestedSchema ||
                    candidate.schema.toLowerCase() === requestedSchema.toLowerCase()),
        );
        if (!object) {
            continue;
        }
        const members = object.members?.length ? object.members : [[undefined, undefined]];
        for (const [memberName, memberType, insertable = true, nullable = true] of members) {
            rows.push([
                cell(requestKey),
                cell(object.schema),
                cell(object.name),
                cell(object.type),
                object.baseObject ? cell(object.baseObject) : nullCell(),
                memberName ? cell(memberName) : nullCell(),
                memberType ? cell(memberType) : nullCell(),
                memberName ? cell(nullable ? "1" : "0") : nullCell(),
                memberName ? cell(insertable ? "1" : "0") : nullCell(),
            ]);
        }
    }
    return result(rows);
}

function objectSearchResult(...objects: CatalogObjectFixture[]): SimpleExecuteResult {
    return result(
        objects.map((object) => [
            cell(object.schema),
            cell(object.name),
            cell(object.type),
            object.baseObject ? cell(object.baseObject) : nullCell(),
        ]),
    );
}

function singleColumnResult(...values: string[]): SimpleExecuteResult {
    return result(values.map((value) => [cell(value)]));
}

function emptyResult(): SimpleExecuteResult {
    return result([]);
}

function result(rows: SimpleExecuteResult["rows"]): SimpleExecuteResult {
    return { rowCount: rows.length, columnInfo: [], rows };
}

function cell(displayValue: string): SimpleExecuteResult["rows"][number][number] {
    return { displayValue, isNull: false };
}

function nullCell(): SimpleExecuteResult["rows"][number][number] {
    return { displayValue: "", isNull: true };
}

function connectionInfo(connectionId: string): ConnectionInfo {
    const connection = new ConnectionInfo();
    connection.connectionId = connectionId;
    return connection;
}

function labelOf(item: vscode.CompletionItem): string {
    return typeof item.label === "string" ? item.label : item.label.label;
}

function queryStrings(client: sinon.SinonStubbedInstance<SqlToolsServiceClient>): string[] {
    return client.sendRequest
        .getCalls()
        .map((call) => (call.args[1] as { queryString: string }).queryString);
}

function codeLensTitle(provider: BetaSqlCodeLensProvider, document: vscode.TextDocument): string {
    return provider.provideCodeLenses(document)[0]?.command?.title ?? "";
}

async function expectMetadataFetchToFail(fetch: Promise<unknown>): Promise<void> {
    try {
        await fetch;
        expect.fail("Expected metadata fetch to fail");
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
    }
}

async function openSqlDocument(text: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ language: Constants.languageId, content: text });
}

function endPosition(document: vscode.TextDocument): vscode.Position {
    return document.positionAt(document.getText().length);
}
