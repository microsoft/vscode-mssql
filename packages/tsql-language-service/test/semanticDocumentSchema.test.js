/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    DocumentSchemaEvolution,
    extractDocumentSchemaChanges,
    semanticObjectIdentity,
    splitMultipartIdentifier,
} = require("../dist/semantic/index.js");

describe("document-local schema evolution", () => {
    it("evolves table columns in script order and preserves objects across GO", () => {
        const sql = `
            CREATE TABLE dbo.Users (
                [Id] INT NOT NULL,
                Name NVARCHAR(100) NULL,
                CONSTRAINT PK_Users PRIMARY KEY (Id)
            );
            GO
            ALTER TABLE Users ADD Email VARCHAR(320) NOT NULL;
            ALTER TABLE dbo.Users ALTER COLUMN Name NVARCHAR(200) NOT NULL;
            ALTER TABLE dbo.Users DROP COLUMN Email;
        `;
        const document = DocumentSchemaEvolution.fromText(sql, { uri: "file:///script.sql" });
        const users = document.resolve(["Users"]);

        assert.deepEqual(users.parts, ["dbo", "Users"]);
        assert.equal(users.uri, "file:///script.sql");
        assert.deepEqual(users.columns, [
            {
                name: "Id",
                type: "INT",
                nullable: false,
                span: { start: sql.indexOf("[Id]"), end: sql.indexOf("[Id]") + 4 },
            },
            {
                name: "Name",
                type: "NVARCHAR(200)",
                nullable: false,
                span: { start: sql.lastIndexOf("Name"), end: sql.lastIndexOf("Name") + 4 },
            },
        ]);
        assert.equal(users.batch, 1);
    });

    it("recognizes qualified and unqualified DDL for tables, views, routines, and functions", () => {
        const document = DocumentSchemaEvolution.fromText(`
            CREATE TABLE PlainTable (Id INT);
            CREATE TABLE sales.QualifiedTable (Id INT);
            CREATE VIEW PlainView AS SELECT 1 AS Id;
            CREATE VIEW reporting.QualifiedView AS SELECT 1 AS Id;
            CREATE PROCEDURE PlainProcedure @Id INT, @Name NVARCHAR(40) = NULL AS SELECT @Id;
            CREATE PROC admin.QualifiedProcedure @Value BIGINT OUTPUT AS SELECT @Value;
            CREATE FUNCTION PlainFunction(@Value INT) RETURNS INT AS BEGIN RETURN @Value; END;
            CREATE FUNCTION dbo.QualifiedTableFunction() RETURNS TABLE AS RETURN (SELECT 1 AS Id);
            GO
        `);

        assert.equal(document.resolve(["PlainTable"]).kind, "table");
        assert.equal(document.resolve(["sales", "QualifiedTable"]).kind, "table");
        assert.equal(document.resolve(["PlainView"]).kind, "view");
        assert.equal(document.resolve(["reporting", "QualifiedView"]).kind, "view");
        assert.deepEqual(
            document
                .resolve(["PlainProcedure"])
                .parameters.map(({ name, type, direction, optional }) => ({
                    name,
                    type,
                    direction,
                    optional,
                })),
            [
                { name: "@Id", type: "INT", direction: "input", optional: false },
                { name: "@Name", type: "NVARCHAR(40)", direction: "input", optional: true },
            ],
        );
        assert.equal(
            document.resolve(["admin", "QualifiedProcedure"]).parameters[0].direction,
            "inputOutput",
        );
        assert.equal(document.resolve(["PlainFunction"]).returnType, "INT");
        assert.equal(document.resolve(["dbo", "QualifiedTableFunction"]).kind, "tableFunction");
    });

    it("applies drops in statement order, including a DROP FUNCTION for table-valued functions", () => {
        const document = DocumentSchemaEvolution.fromText(`
            CREATE TABLE dbo.Transient (Id INT);
            CREATE FUNCTION dbo.TransientRows() RETURNS TABLE AS RETURN (SELECT 1 AS Id);
            DROP TABLE dbo.Transient;
            DROP FUNCTION dbo.TransientRows;
        `);

        assert.equal(document.resolve(["Transient"]), undefined);
        assert.equal(document.resolve(["TransientRows"]), undefined);
    });

    it("resolves only DDL visible at a reference offset and retains the declaration span", () => {
        const sql = `
            SELECT * FROM Future;
            CREATE TABLE dbo.Future (Id INT NOT NULL);
            GO
            SELECT Id FROM dbo.Future;
            ALTER TABLE dbo.Future ADD Name NVARCHAR(40) NULL;
            SELECT Name FROM Future;
            DROP TABLE dbo.Future;
            SELECT * FROM Future;
        `;
        const changes = extractDocumentSchemaChanges(sql);
        const create = changes.find((change) => change.operation === "replace");
        const add = changes.find((change) => change.operation === "addColumns");
        const drop = changes.find((change) => change.operation === "drop");
        const document = new DocumentSchemaEvolution(changes);

        assert.equal(
            document.resolveAt(["Future"], sql.indexOf("SELECT * FROM Future")),
            undefined,
        );
        assert.equal(document.resolveAt(["Future"], create.span.start), undefined);
        assert.deepEqual(
            document.resolveAt(["Future"], create.span.end).columns.map((column) => column.name),
            ["Id"],
        );
        assert.deepEqual(
            document.columnsForAt(["Future"], add.span.start).map((column) => column.name),
            ["Id"],
        );
        assert.deepEqual(
            document
                .atOffset(add.span.end)
                .columnsFor(["Future"])
                .map((column) => column.name),
            ["Id", "Name"],
        );
        assert.deepEqual(document.definitionSpanAt(["Future"], add.span.end), create.span);
        assert.equal(document.resolveAt(["Future"], drop.span.end), undefined);
    });

    it("accepts AST-normalized changes and ignores ALTER TABLE changes before a declaration", () => {
        const span = (start) => ({ start, end: start + 1 });
        const document = new DocumentSchemaEvolution([
            {
                operation: "addColumns",
                kind: "table",
                nameParts: ["Queue"],
                columns: [{ name: "Ignored", type: "int" }],
                span: span(0),
            },
            {
                operation: "create",
                kind: "table",
                nameParts: ["Queue"],
                columns: [{ name: "Id", type: "int", nullable: false }],
                span: span(1),
            },
            {
                operation: "addColumns",
                kind: "table",
                nameParts: ["dbo", "Queue"],
                columns: [{ name: "Payload", type: "varbinary(max)" }],
                span: span(2),
            },
        ]);

        assert.deepEqual(document.columnsFor(["Queue"]), [
            { name: "Id", type: "int", nullable: false },
            { name: "Payload", type: "varbinary(max)" },
        ]);
        assert.deepEqual(splitMultipartIdentifier("[db].[sales].[Order.Detail]"), [
            "db",
            "sales",
            "Order.Detail",
        ]);
        assert.equal(semanticObjectIdentity("table", ["dbo", "Queue"]).key, "table:dbo.queue");
        assert.equal(
            extractDocumentSchemaChanges("-- CREATE TABLE ignored\nCREATE TABLE Actual (Id INT);")
                .length,
            1,
        );
    });
});
