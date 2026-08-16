/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    analyzeSql: analyze,
    createMetadata: metadata,
    messages,
    table,
} = require("../../support/semanticHarness.js");

suite("T-SQL catalog object resolution diagnostics", () => {
    // A complete catalog is authoritative for unresolved read and DML targets.
    test("reports missing catalog objects and procedures without guessing on pending metadata", async () => {
        const closed = await analyze(
            "SELECT * FROM dbo.Missing; INSERT dbo.Missing(Id) VALUES (1); EXEC dbo.MissingProc;",
            metadata(),
        );
        assert.deepEqual(messages(closed), [
            "Invalid object name 'dbo.Missing'.",
            "Invalid object name 'dbo.Missing'.",
            "Could not find stored procedure 'dbo.MissingProc'.",
        ]);

        const pending = await analyze(
            "SELECT * FROM dbo.Missing;",
            metadata({ completeness: { objects: "loading" } }),
        );
        assert.deepEqual(pending, []);
    });
    // Local DDL follows execution order across GO instead of becoming globally visible.
    test("tracks CREATE and DROP visibility by source offset", async () => {
        const sql = `
SELECT * FROM dbo.Work;
CREATE TABLE dbo.Work (Id int);
GO
SELECT Id FROM dbo.Work;
DROP TABLE dbo.Work;
SELECT * FROM dbo.Work;`;
        const diagnostics = await analyze(sql, metadata({ schemas: [{ name: "dbo" }] }));
        assert.deepEqual(
            diagnostics.filter(({ code }) => code === "MSSQL208").map(({ message }) => message),
            ["Invalid object name 'dbo.Work'.", "Invalid object name 'dbo.Work'."],
        );
        assert.equal(
            diagnostics.some(({ message }) => message.includes("Invalid column")),
            false,
        );
    });
    // Views and table-valued functions participate in the same ordered local relation timeline,
    // and a local DROP must override an older pinned-catalog object.
    test("tracks document-local views, table functions, and stale catalog drops", async () => {
        const provider = metadata({
            schemas: [{ database: "db", name: "dbo" }],
            objects: [table("catalog-work", "dbo", "CatalogWork")],
            columns: new Map([["catalog-work", [{ name: "Id", typeDisplay: "int" }]]]),
        });
        const diagnostics = await analyze(
            `CREATE OR ALTER VIEW dbo.LocalView (ViewId) AS SELECT 1 AS Id;
GO
SELECT ViewId FROM dbo.LocalView;
GO
CREATE OR ALTER FUNCTION dbo.LocalRows() RETURNS TABLE AS RETURN (SELECT 1 AS ItemId);
GO
SELECT f.ItemId FROM dbo.LocalRows() AS f;
GO
DROP VIEW dbo.LocalView;
SELECT * FROM dbo.LocalView;
DROP TABLE dbo.CatalogWork;
SELECT * FROM dbo.CatalogWork;`,
            provider,
        );

        assert.deepEqual(
            diagnostics.filter(({ code }) => code === "MSSQL208").map(({ message }) => message),
            ["Invalid object name 'dbo.LocalView'.", "Invalid object name 'dbo.CatalogWork'."],
        );
        assert.equal(
            diagnostics.some(({ code }) => code === "MSSQL207"),
            false,
        );
    });
    // Other relation-producing statements become visible only after their statement, while an
    // unknown synonym shape remains non-authoritative instead of creating phantom column errors.
    test("tracks local SELECT INTO, external tables, and synonyms", async () => {
        const diagnostics = await analyze(
            `SELECT 1 AS IntoId INTO dbo.IntoRows;
GO
SELECT IntoId FROM dbo.IntoRows;
GO
CREATE EXTERNAL TABLE dbo.ExternalRows (ExternalId int)
WITH (LOCATION = '/rows', DATA_SOURCE = SourceName);
GO
SELECT ExternalId FROM dbo.ExternalRows;
GO
CREATE SYNONYM dbo.LocalSynonym FOR remoteDb.dbo.RemoteRows;
GO
SELECT UnknownRemoteColumn FROM dbo.LocalSynonym;`,
            metadata({ schemas: [{ database: "db", name: "dbo" }] }),
        );

        assert.deepEqual(
            diagnostics.filter(({ code }) => ["MSSQL207", "MSSQL208"].includes(code)),
            [],
        );
    });
});
