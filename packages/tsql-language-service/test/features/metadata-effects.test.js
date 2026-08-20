/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { metadataSectionsInvalidatedByExecutedSql } = require("../../dist/index.js");

const allSections = [
    "databases",
    "schemas",
    "objects",
    "columns",
    "parameters",
    "principals",
    "definitions",
];

suite("executed SQL metadata effects", () => {
    // Principal DDL uses the isolated authoritative principal refresh rather than reloading every
    // object identity and detail section.
    test("isolates principal-only mutations", () => {
        for (const sql of [
            "CREATE LOGIN tempChange WITH PASSWORD='x';",
            "DROP USER [tempChange];",
            "ALTER SERVER ROLE [sysadmin] ADD MEMBER [tempChange];",
        ]) {
            assert.deepEqual(metadataSectionsInvalidatedByExecutedSql(sql), ["principals"], sql);
        }
    });

    // Structural catalog statements invalidate the complete identity/detail set even when the
    // spelling contains quoted identifiers or an astral UTF-16 surrogate pair before the DDL.
    test("classifies structural catalog mutations through the syntax tree", () => {
        for (const sql of [
            "SELECT N'😀'; CREATE TABLE [odd schema].[Order-Items] (id int);",
            "ALTER TABLE dbo.T ADD name nvarchar(50);",
            "DROP VIEW dbo.V;",
            "CREATE OR ALTER PROCEDURE dbo.p AS SELECT 1;",
            "CREATE UNIQUE CLUSTERED INDEX IX_T ON dbo.T(id);",
            "GRANT SELECT ON dbo.T TO app_user;",
            "DISABLE TRIGGER dbo.tr_T ON dbo.T;",
            "EXEC sys.sp_rename N'dbo.T', N'T2';",
        ]) {
            assert.deepEqual(metadataSectionsInvalidatedByExecutedSql(sql), allSections, sql);
        }
    });

    // SELECT INTO is scoped to its parsed statement, so a later INSERT INTO cannot be paired with
    // an earlier SELECT as happened with the cross-statement wildcard expression.
    test("does not cross statement or batch boundaries", () => {
        assert.deepEqual(
            metadataSectionsInvalidatedByExecutedSql(
                "SELECT 1;\nINSERT INTO dbo.T(id) VALUES (1);\nGO\nSELECT 2;",
            ),
            [],
        );
        assert.deepEqual(
            metadataSectionsInvalidatedByExecutedSql(
                "CREATE USER app_user WITHOUT LOGIN;\nSELECT 1;\nINSERT dbo.T VALUES (1);",
            ),
            ["principals"],
        );
    });

    // Both bare and bracketed local temporary SELECT INTO targets are session state, not durable
    // catalog objects, while a persistent target still requires a catalog refresh.
    test("distinguishes temporary and persistent SELECT INTO targets", () => {
        assert.deepEqual(
            metadataSectionsInvalidatedByExecutedSql("SELECT 1 INTO #local_temp;"),
            [],
        );
        assert.deepEqual(
            metadataSectionsInvalidatedByExecutedSql("SELECT 1 INTO [#local temp];"),
            [],
        );
        assert.deepEqual(
            metadataSectionsInvalidatedByExecutedSql("SELECT 1 INTO [dbo].[Persistent];"),
            allSections,
        );
    });

    // Parser trivia and literal tokens prevent examples, nested comments, escaped delimiters, and
    // dynamic SQL text from being reinterpreted as executed catalog statements.
    test("ignores mutation words in non-code text", () => {
        const sql = `
            -- CREATE LOGIN fake
            /* outer 😀 /* DROP TABLE dbo.T */ still comment */
            SELECT N'ALTER USER fake', [CREATE], [DROP TABLE], 'escaped '' CREATE TABLE dbo.X';
        `;
        assert.deepEqual(metadataSectionsInvalidatedByExecutedSql(sql), []);
    });
});
