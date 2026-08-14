/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

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

    // Verifies JSON/vector indexes use SqlParser's leading diagnostic on pre-2025 profiles.
    test("reports version-gated index syntax for compatibility 160", () => {
        const service = new LezerSyntaxService(undefined, {
            serverMajorVersion: 16,
            compatibilityLevel: 160,
            engineFlavor: "sql-server",
            previewFeatures: false,
        });
        const sql = "CREATE JSON INDEX IX_J ON dbo.t(j); CREATE VECTOR INDEX IX_V ON dbo.t(v);";
        const snapshot = service.parse(new ImmutableTextSnapshot("file:///version.sql", 1, sql));
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'JSON'.",
                severity: "error",
                range: { start: 7, end: 11 },
            },
            {
                code: "syntax",
                message: "Incorrect syntax near 'VECTOR'.",
                severity: "error",
                range: { start: 43, end: 49 },
            },
        ]);
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

function parse(sql) {
    return new LezerSyntaxService().parse(new ImmutableTextSnapshot("file:///ddl.sql", 1, sql));
}
