/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../../../dist/index.js");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("ddl.sql");

// Clone tables are Fabric Data Warehouse syntax and distributed CTAS is analytics-engine
// syntax, so those structural fixtures are read under the profile that owns them. The
// availability gate on every other profile is covered by the dialect inventory.
const fabricProfile = {
    engineProfile: "fabric-warehouse",
    serverMajorVersion: 16,
    compatibilityLevel: 160,
    previewFeatures: false,
};
const analyticsProfile = {
    engineProfile: "azure-synapse-dedicated",
    serverMajorVersion: 13,
    compatibilityLevel: 130,
    previewFeatures: false,
};

suite("T-SQL table and index DDL grammar", () => {
    // Verifies ordinary and temporary CREATE TABLE definitions parse without recovery nodes.
    test("parses columns and table constraints", () => {
        const snapshot = parse(`
CREATE TABLE #Work (
    Id bigint IDENTITY(1, 1) NOT NULL,
    Name nvarchar(100) COLLATE Latin1_General_100_CI_AS NOT NULL,
    ParentId bigint NULL,
    CONSTRAINT PK_Work PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Work_Parent FOREIGN KEY (ParentId) REFERENCES dbo.Parent(Id),
    CONSTRAINT CK_Work_Name CHECK (Name <> N'')
);
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateTableStatement\(/);
        assert.equal((tree.match(/ColumnDefinition\(/g) ?? []).length, 3);
        assert.equal((tree.match(/TableConstraint\(/g) ?? []).length, 3);
    });

    // Verifies temporal generated columns, PERIOD, and table options remain structured.
    test("parses temporal table syntax", () => {
        const snapshot = parse(`
CREATE TABLE dbo.HistorySource (
    Id int NOT NULL PRIMARY KEY,
    ValidFrom datetime2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo datetime2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON);
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/GeneratedColumnKind\(/g) ?? []).length, 2);
        assert.match(tree, /PeriodDefinition\(/);
        assert.match(tree, /TableOptionClause\(/);
    });

    // Verifies SQL Server 2025 VECTOR and JSON types retain both type parameters and nullability.
    test("parses modern JSON and VECTOR columns", () => {
        const snapshot = parse(`
CREATE TABLE dbo.ModernData (
    Document json NULL,
    Embedding vector(1536, FLOAT32) NOT NULL
);
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /DataType\(DataTypeName\(MultipartIdentifier.+OpenParen,ArgumentList/);
        assert.equal((tree.match(/ColumnDefinition\(/g) ?? []).length, 2);
    });

    // Verifies Fabric table cloning retains both current and point-in-time source forms.
    test("parses cloned table sources", () => {
        const snapshot = parse(
            `
CREATE TABLE dbo.EmployeeCopy AS CLONE OF hr.Employee;
CREATE TABLE dbo.EmployeeHistory AS CLONE OF hr.Employee AT '2026-08-14T12:00:00';
`,
            fabricProfile,
        );
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/CreateTableStatement\(/g) ?? []).length, 2);
    });

    // Verifies CTAS can assign output column names before the physical table options.
    test("parses CTAS with an output column list", () => {
        const snapshot = parse(
            `
CREATE TABLE dbo.OrderSummary (OrderId, Total)
WITH (DISTRIBUTION = HASH(OrderId))
AS SELECT OrderId, Total FROM sales.Orders;
`,
            analyticsProfile,
        );
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /CtasColumnNameList/);
    });

    // Verifies regular filtered index syntax and SQL Server 2025 JSON/vector index statements.
    test("parses rowstore, JSON, and vector indexes", () => {
        const snapshot = parse(`
CREATE UNIQUE NONCLUSTERED INDEX IX_Filtered ON dbo.Items(Id DESC)
INCLUDE (Name) WHERE Active = 1 WITH (ONLINE = ON);
CREATE JSON INDEX IX_Json ON dbo.Items(Document) FOR ('$.name', '$.tags');
CREATE VECTOR INDEX IX_Vector ON dbo.Items(Embedding)
WITH (METRIC = 'cosine', TYPE = 'diskann');
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateIndexStatement\(/);
        assert.match(tree, /CreateJsonIndexStatement\(/);
        assert.match(tree, /CreateVectorIndexStatement\(/);
    });

    // Verifies JSON/vector indexes use the reviewed leading diagnostic on pre-2025 profiles.
    test("reports version-gated index syntax for compatibility 160", () => {
        const service = new LezerSyntaxService(undefined, {
            serverMajorVersion: 16,
            compatibilityLevel: 160,
            engineProfile: "sql-server",
            previewFeatures: false,
        });
        const sql = "CREATE JSON INDEX IX_J ON dbo.t(j); CREATE VECTOR INDEX IX_V ON dbo.t(v);";
        const snapshot = service.parse(new ImmutableTextSnapshot("file:///version.sql", 1, sql));
        assert.deepEqual(
            snapshot.diagnostics.map(({ code, availability, range }) => ({
                code,
                featureId: availability.featureId,
                range,
            })),
            [
                {
                    code: "FeatureNotAvailable",
                    featureId: "statement.create-json-index",
                    range: { start: 7, end: 11 },
                },
                {
                    code: "FeatureNotAvailable",
                    featureId: "statement.create-vector-index",
                    range: { start: 43, end: 49 },
                },
            ],
        );
    });

    // Verifies ALTER/DROP table and index actions do not fall through generic recovery.
    test("parses table and index maintenance", () => {
        const snapshot = parse(`
ALTER TABLE dbo.Items ADD SearchText nvarchar(max) NULL;
ALTER TABLE dbo.Items ALTER COLUMN SearchText nvarchar(max) NOT NULL;
ALTER TABLE dbo.Items DROP COLUMN SearchText;
ALTER INDEX ALL ON dbo.Items REBUILD WITH (ONLINE = ON);
ALTER INDEX IX_Filtered ON dbo.Items REORGANIZE;
DROP INDEX IF EXISTS IX_Filtered ON dbo.Items;
DROP TABLE IF EXISTS dbo.Items, dbo.ItemsHistory;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/AlterTableStatement\(/g) ?? []).length, 3);
        assert.equal((tree.match(/AlterIndexStatement\(/g) ?? []).length, 2);
        assert.match(tree, /DropIndexStatement\(/);
        assert.match(tree, /DropTableStatement\(/);
    });
});
