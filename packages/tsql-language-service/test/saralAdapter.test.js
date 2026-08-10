/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MappingCatalogProvider, SaralSqlAnalysisEngine } = require("../dist/index.js");

const users = [
    { name: "Id", type: "int", nullable: false },
    { name: "DisplayName", type: "nvarchar(100)", nullable: true },
];

function createCatalog(world = "closed") {
    return {
        version: 1,
        world,
        columnsFor(parts) {
            return parts.join(".").toLowerCase() === "dbo.users" ? users : undefined;
        },
        objectFor(parts) {
            switch (parts.join(".").toLowerCase()) {
                case "dbo.users":
                    return { parts: ["dbo", "Users"], kind: "table", columns: users };
                case "dbo.refreshusers":
                    return { parts: ["dbo", "RefreshUsers"], kind: "procedure" };
                default:
                    return undefined;
            }
        },
        tableCandidates(parts) {
            return parts.length === 1 ? [["dbo", parts[0]]] : [];
        },
    };
}

describe("SaralSqlAnalysisEngine", () => {
    it("reuses unchanged GO batches without mutating prior snapshots", () => {
        const engine = new SaralSqlAnalysisEngine();
        const firstText = "SELECT 1;\nGO\nSELECT 2;";
        const first = engine.createSnapshot({ text: firstText, uri: "file:///query.sql" });
        const firstStatements = structuredClone(first.statements);
        const second = engine.updateSnapshot(first, {
            text: "SELECT 1;\nGO\nSELECT 3;",
        });

        assert.equal(engine.capabilities.incrementalUpdate.level, "partial");
        assert.deepEqual(first.incrementalStatistics, {
            parsedBatchCount: 2,
            reusedBatchCount: 0,
            totalBatchCount: 2,
            reusedCharacterCount: 0,
            totalCharacterCount: 19,
        });
        assert.equal(second.incrementalStatistics.parsedBatchCount, 1);
        assert.equal(second.incrementalStatistics.reusedBatchCount, 1);
        assert.equal(second.version, first.version + 1);
        assert.equal(second.uri, first.uri);
        assert.equal(first.text, firstText);
        assert.deepEqual(first.statements, firstStatements);
    });

    it("reports exact catalog object diagnostics for query, DML, MERGE, and EXEC targets", () => {
        const text = [
            "SELECT m.Id FROM dbo.Missing AS m;",
            "INSERT INTO dbo.MissingInsert (Id) VALUES (1);",
            "UPDATE dbo.MissingUpdate SET Id = 2;",
            "DELETE FROM dbo.MissingDelete;",
            "MERGE dbo.MissingMerge AS target USING dbo.Users AS source",
            "ON target.Id = source.Id WHEN MATCHED THEN UPDATE SET target.Id = source.Id;",
            "EXEC dbo.MissingProc;",
            "EXEC dbo.RefreshUsers;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });
        const diagnostics = snapshot.semanticDiagnostics.filter(
            (diagnostic) => diagnostic.code === "MSSQL208",
        );
        const missing = [
            "dbo.Missing",
            "dbo.MissingInsert",
            "dbo.MissingUpdate",
            "dbo.MissingDelete",
            "dbo.MissingMerge",
            "dbo.MissingProc",
        ];

        assert.deepEqual(
            diagnostics.map((diagnostic) => diagnostic.message),
            missing.map((name) => `Invalid object name '${name}'.`),
        );
        assert.deepEqual(
            diagnostics.map((diagnostic) => text.slice(diagnostic.span.start, diagnostic.span.end)),
            missing,
        );
        assert.equal(
            snapshot.mutationTargets().some((target) => target.operation === "merge"),
            true,
        );
    });

    it("reports MSSQL208 for a missing multiline INSERT target", () => {
        const text = `insert into dbo.hhh (
    Name,
    CreatedDate
)
VALUES (
    NULL,
    NULL
);`;
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [
                {
                    kind: "semantic",
                    code: "MSSQL208",
                    message: "Invalid object name 'dbo.hhh'.",
                    span: { start: text.indexOf("dbo.hhh"), end: text.indexOf("dbo.hhh") + 7 },
                    severity: "error",
                },
            ],
        );
    });

    it("does not cascade a recovered INSERT target into an invalid-keyword object error", () => {
        const text = [
            "INSERT INTO -- unfinished target",
            "IF OBJECT_ID(N'SchemaName.TableName', N'U') IS NOT NULL",
            "    DROP TABLE SchemaName.TableName;",
            "GO",
            "CREATE TABLE SchemaName.TableName (Id int);",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.equal(
            snapshot.syntaxDiagnostics.some(
                (diagnostic) => diagnostic.message === "Incorrect syntax near 'IF'.",
            ),
            true,
        );
        assert.equal(
            snapshot.semanticDiagnostics.some(
                (diagnostic) =>
                    diagnostic.code === "MSSQL208" && diagnostic.message.includes("'IF'"),
            ),
            false,
        );
    });

    it("does not report valid unmodeled external DDL as SQL syntax errors", () => {
        const text = [
            "CREATE DATABASE SCOPED CREDENTIAL [sa] WITH IDENTITY = N'sa', SECRET = N'test';",
            "CREATE EXTERNAL DATA SOURCE [MyDs] WITH (LOCATION = N'sqlserver://localhost');",
            "CREATE EXTERNAL TABLE dbo.ExternalRows ([Id] int) WITH (LOCATION = N'/rows', DATA_SOURCE = [MyDs]);",
            "N",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text });

        assert.deepEqual(snapshot.syntaxDiagnostics, [
            {
                kind: "syntax",
                code: "syntax",
                message: "Incorrect syntax near 'N'.",
                span: { start: text.length - 1, end: text.length },
                severity: "error",
            },
        ]);
    });

    it("binds schema-qualified document DDL in statement order across GO batches", () => {
        const text = [
            "CREATE TABLE dbo.gbf ([ggg] int NULL, [ColumnName] nvarchar(20) NOT NULL);",
            "GO",
            "SELECT g.ggg, g.ColumnName FROM dbo.gbf AS g;",
            "INSERT INTO dbo.gbf ([ggg], [ColumnName]) VALUES (1, N'one');",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [],
        );
        assert.equal(snapshot.typeAt(text.indexOf("g.ggg") + 3).display.toLowerCase(), "int");
        assert.equal(
            snapshot.typeAt(text.indexOf("g.ColumnName") + "g.Column".length).display.toLowerCase(),
            "nvarchar(20)",
        );
        const reference = snapshot.symbolAt(text.lastIndexOf("dbo.gbf") + 5);
        assert.equal(text.slice(reference.definition.start, reference.definition.end), "dbo.gbf");
    });

    it("binds conditional CREATE TABLE statements used by deployment scripts", () => {
        const text = [
            "IF OBJECT_ID(N'dbo.LongTextTable', N'U') IS NULL",
            "BEGIN",
            "    CREATE TABLE dbo.LongTextTable (Id int, Payload varchar(max));",
            "END;",
            "GO",
            "SELECT Payload FROM dbo.LongTextTable;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [],
        );
        assert.equal(
            snapshot.typeAt(text.lastIndexOf("Payload")).display.toLowerCase(),
            "varchar(max)",
        );
    });

    it("applies USE database context to later two- and three-part object references", () => {
        const text = [
            "USE TestData_1M;",
            "GO",
            "IF OBJECT_ID(N'dbo.EmployeeData', N'U') IS NULL",
            "BEGIN",
            "    CREATE TABLE dbo.EmployeeData (EmployeeId int);",
            "END;",
            "GO",
            "SELECT * FROM dbo.EmployeeData;",
            "SELECT * FROM [TestData_1M].[dbo].[EmployeeData];",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [],
        );
    });

    it("validates explicit CTE columns and implicit aliases without leaking sibling sources", () => {
        const text = [
            "CREATE TABLE dbo.EmployeeData (ID int, Department nvarchar(50), Salary decimal(12,2));",
            "WITH E1(N) AS (SELECT 1 UNION ALL SELECT 1),",
            "E2(N) AS (SELECT 1 FROM E1 a CROSS JOIN E1 b),",
            "RowsToInsert(RowNumber) AS (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) FROM E2)",
            "INSERT INTO dbo.EmployeeData (ID, Department, Salary)",
            "SELECT RowNumber, N'Engineering', 50000 FROM RowsToInsert;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(snapshot.syntaxDiagnostics, []);
        assert.deepEqual(snapshot.semanticDiagnostics, []);
    });

    it("resolves unqualified columns in the nearest nested query and accepts FOR XML directives", () => {
        const text = [
            "CREATE TABLE dbo.EmployeeData (ID int, Department nvarchar(50), Salary decimal(12,2));",
            "SELECT Department, AVG(Salary),",
            "  (SELECT TOP 3 Salary FROM dbo.EmployeeData AS e2 ORDER BY Salary DESC FOR XML PATH('Employee'), TYPE)",
            "FROM dbo.EmployeeData AS e1",
            "GROUP BY Department",
            "FOR XML RAW('Department'), ELEMENTS;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(snapshot.syntaxDiagnostics, []);
        assert.deepEqual(snapshot.semanticDiagnostics, []);
    });

    it("does not leak tables declared inside stored module bodies into the script catalog", () => {
        const text = [
            "CREATE PROCEDURE dbo.BuildHidden AS",
            "BEGIN",
            "    CREATE TABLE dbo.HiddenAtRuntime (Id int);",
            "END;",
            "GO",
            "SELECT * FROM dbo.HiddenAtRuntime;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(
            snapshot.semanticDiagnostics
                .filter((diagnostic) => diagnostic.code === "MSSQL208")
                .map((diagnostic) => diagnostic.message),
            ["Invalid object name 'dbo.HiddenAtRuntime'."],
        );
    });

    it("does not make document DDL visible before CREATE or after DROP", () => {
        const text = [
            "SELECT * FROM dbo.Later;",
            "CREATE TABLE dbo.Later (Id int);",
            "SELECT Id FROM dbo.Later;",
            "DROP TABLE dbo.Later;",
            "SELECT * FROM dbo.Later;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });
        const missing = snapshot.semanticDiagnostics.filter(
            (diagnostic) => diagnostic.code === "MSSQL208",
        );

        assert.deepEqual(
            missing.map((diagnostic) => diagnostic.span.start),
            [text.indexOf("dbo.Later"), text.lastIndexOf("dbo.Later")],
        );
    });

    it("applies ALTER TABLE columns to later completion and validation only", () => {
        const text = [
            "CREATE TABLE dbo.Evolving (Id int NOT NULL);",
            "ALTER TABLE dbo.Evolving ADD Label nvarchar(40) NULL;",
            "SELECT e.Label FROM dbo.Evolving AS e;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.equal(
            snapshot.typeAt(text.indexOf("e.Label") + 3).display.toLowerCase(),
            "nvarchar(40)",
        );
        assert.equal(
            snapshot.semanticDiagnostics.some(
                (diagnostic) =>
                    diagnostic.code === "unknown-column" || diagnostic.code === "MSSQL207",
            ),
            false,
        );
    });

    it("uses catalog columns for qualified completion and type lookup", () => {
        const text = "SELECT u.DisplayName FROM Users AS u";
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });
        const columnOffset = text.indexOf("DisplayName") + 2;
        const completionText = "SELECT u.Dis FROM Users AS u";
        const completionSnapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text: completionText,
            catalog: createCatalog(),
        });
        const completionOffset = completionText.indexOf("Dis") + 3;

        assert.deepEqual(snapshot.typeAt(columnOffset), {
            kind: "scalar",
            name: "nvarchar(100)",
            display: "nvarchar(100)",
        });
        assert.deepEqual(completionSnapshot.completeAt(completionOffset), {
            items: [
                {
                    label: "DisplayName",
                    kind: "column",
                    detail: "nvarchar(100)",
                    documentation: "Column `DisplayName` has SQL type `nvarchar(100)`.",
                },
            ],
            replaceSpan: {
                start: completionText.indexOf("Dis"),
                end: completionOffset,
            },
            context: {
                kind: "qualifiedMember",
                qualifiers: ["u"],
                prefix: "Dis",
                replaceSpan: {
                    start: completionText.indexOf("Dis"),
                    end: completionOffset,
                },
            },
        });
        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [],
        );

        const builtin = new SaralSqlAnalysisEngine().createSnapshot({
            text: "SELECT COUNT(*) FROM dbo.Users",
            catalog: createCatalog(),
        });
        assert.equal(
            builtin.semanticDiagnostics.some((item) => item.code === "MSSQL208"),
            false,
        );
    });

    it("returns parser-owned relation context after a JSON and temporary-table script", () => {
        const text = `CREATE TABLE #ProductsWithJson (
    ProductId INT,
    ProductName NVARCHAR(100),
    JsonData NVARCHAR(MAX)
);
INSERT INTO #ProductsWithJson (ProductId, ProductName, JsonData)
VALUES (1, 'Laptop', '{"brand":"Dell"}');
SELECT ProductId, JSON_VALUE(JsonData, '$.brand') AS Brand
FROM #ProductsWithJson;
DROP TABLE #ProductsWithJson;

SELECT * FROM dbo.`;
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text });
        const result = snapshot.completeAt(text.length);

        assert.deepEqual(result.context, {
            kind: "object",
            qualifiers: ["dbo"],
            prefix: "",
            replaceSpan: { start: text.length, end: text.length },
        });
        assert.equal(snapshot.text, text);
    });

    it("caps relation completion for a large catalog without losing prefix matches", () => {
        const tables = {};
        for (let index = 0; index < 1_000; index++) {
            tables[`Table${String(index).padStart(4, "0")}`] = { Id: "int" };
        }
        const text = "SELECT * FROM dbo.Ta";
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: new MappingCatalogProvider({ dbo: tables }, 1, "closed"),
        });
        const completion = snapshot.completeAt(text.length);

        assert.equal(completion.items.length, 200);
        assert.equal(
            completion.items.some((item) => item.label === "Table0000"),
            true,
        );
    });

    it("classifies partial relation, execute, and qualified-member completion from one snapshot", () => {
        const cases = [
            {
                text: "SELECT * FROM ",
                context: {
                    kind: "object",
                    qualifiers: [],
                    prefix: "",
                    replaceSpan: { start: 14, end: 14 },
                },
            },
            {
                text: "SELECT * FROM d",
                context: {
                    kind: "object",
                    qualifiers: [],
                    prefix: "d",
                    replaceSpan: { start: 14, end: 15 },
                },
            },
            {
                text: "SELECT * FROM dbo.[Ord",
                context: {
                    kind: "object",
                    qualifiers: ["dbo"],
                    prefix: "Ord",
                    replaceSpan: { start: 18, end: 22 },
                },
            },
            {
                text: "SELECT * FROM Linked.Warehouse.sales.Ord",
                context: {
                    kind: "object",
                    qualifiers: ["Linked", "Warehouse", "sales"],
                    prefix: "Ord",
                    replaceSpan: { start: 37, end: 40 },
                },
            },
            {
                text: "EXEC dbo.",
                context: {
                    kind: "execute",
                    qualifiers: ["dbo"],
                    prefix: "",
                    replaceSpan: { start: 9, end: 9 },
                },
            },
            {
                text: "SELECT u. FROM dbo.Users AS u",
                offset: 9,
                context: {
                    kind: "qualifiedMember",
                    qualifiers: ["u"],
                    prefix: "",
                    replaceSpan: { start: 9, end: 9 },
                },
            },
            {
                text: 'SELECT "Remote"."Warehouse"."dbo"."Users".',
                context: {
                    kind: "qualifiedMember",
                    qualifiers: ["Remote", "Warehouse", "dbo", "Users"],
                    prefix: "",
                    replaceSpan: { start: 42, end: 42 },
                },
            },
        ];

        for (const testCase of cases) {
            const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text: testCase.text });
            assert.deepEqual(
                snapshot.completeAt(testCase.offset ?? testCase.text.length).context,
                testCase.context,
            );
        }
    });

    it("binds XML method receivers and generated nodes columns without catalog false positives", () => {
        const text = `SELECT
    t.Id,
    n.value('(Name/text())[1]', 'nvarchar(100)') AS Name,
    n.value('(Value/text())[1]', 'int') AS Value
FROM dbo.XmlDocuments AS t
CROSS APPLY t.XmlData.nodes('/Root/Item') AS x(n)
WHERE n.exist('Value[. > 10]') = 1;`;
        const xmlColumns = [
            { name: "Id", type: "int", nullable: false },
            { name: "XmlData", type: "xml", nullable: true },
        ];
        const catalog = {
            version: 1,
            world: "closed",
            columnsFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.xmldocuments"
                    ? xmlColumns
                    : undefined;
            },
            objectFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.xmldocuments"
                    ? { parts: ["dbo", "XmlDocuments"], kind: "table", columns: xmlColumns }
                    : undefined;
            },
            tableCandidates() {
                return [];
            },
        };
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text, catalog });

        assert.deepEqual(snapshot.semanticDiagnostics, []);
        assert.equal(
            snapshot
                .externalReferences()
                .some(
                    (reference) =>
                        reference.kind === "table" && reference.name === "t.XmlData.nodes",
                ),
            false,
        );
        assert.equal(
            snapshot
                .symbols()
                .some((symbol) => symbol.name === "t.XmlData" && symbol.kind === "column"),
            true,
        );
        assert.equal(
            snapshot.symbols().some((symbol) => symbol.name === "n" && symbol.kind === "column"),
            true,
        );
    });

    it("resolves catalog-backed spatial methods and properties", () => {
        const text = "SELECT s.Shape.STArea(), s.Shape.STSrid FROM dbo.SpatialRows AS s;";
        const spatialColumns = [{ name: "Shape", type: "geometry", nullable: true }];
        const catalog = {
            version: 1,
            world: "closed",
            columnsFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.spatialrows"
                    ? spatialColumns
                    : undefined;
            },
            objectFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.spatialrows"
                    ? { parts: ["dbo", "SpatialRows"], kind: "table", columns: spatialColumns }
                    : undefined;
            },
            tableCandidates() {
                return [];
            },
        };
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text, catalog });

        assert.deepEqual(snapshot.syntaxDiagnostics, []);
        assert.deepEqual(snapshot.semanticDiagnostics, []);
        assert.equal(snapshot.typeAt(text.indexOf("STArea") + 2).display, "FLOAT");
        assert.equal(snapshot.typeAt(text.indexOf("STSrid") + 2).display, "INT");
    });

    it("retains, replaces, and removes catalogs according to update semantics", () => {
        const engine = new SaralSqlAnalysisEngine();
        const first = engine.createSnapshot({
            text: "SELECT u.Id FROM dbo.Users AS u",
            catalog: createCatalog(),
        });
        const retained = engine.updateSnapshot(first, {
            text: "SELECT u.DisplayName FROM dbo.Users AS u",
        });
        const open = engine.updateSnapshot(retained, {
            text: "SELECT m.Id FROM dbo.Missing AS m",
            catalog: createCatalog("open"),
        });
        const removed = engine.updateSnapshot(retained, {
            text: "SELECT m.Id FROM dbo.Missing AS m",
            catalog: null,
        });

        assert.equal(
            retained.typeAt(retained.text.indexOf("DisplayName") + 1).display,
            "nvarchar(100)",
        );
        assert.equal(
            open.semanticDiagnostics.some((item) => item.code === "MSSQL208"),
            false,
        );
        assert.equal(
            removed.semanticDiagnostics.some((item) => item.code === "MSSQL208"),
            false,
        );
        assert.equal(first.text, "SELECT u.Id FROM dbo.Users AS u");
    });
});
