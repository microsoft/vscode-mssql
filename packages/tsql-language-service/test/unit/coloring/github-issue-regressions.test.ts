/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { classificationOf, colorize } from "../support/coloringHarness.ts";

suite("GitHub issue coloring regressions", () => {
    test("keeps backslashes inside strings (vscode-mssql#955, #1047, #1653, #1657, #1680, #16934, #1700, #17455, #1799; azuredatastudio#10208, #10471, #11150, #11244, #11571)", async () => {
        const sql = String.raw`SELECT CHARINDEX('\', Path), 'C:\'; SELECT 1;`;
        const { tokens } = await colorize(sql);

        assert.deepEqual(classificationOf(tokens, sql, "SELECT", 1), {
            type: "keyword",
            modifiers: [],
        });
        assert.deepEqual(classificationOf(tokens, sql, "'C:\\'"), {
            type: "string",
            modifiers: [],
        });
    });

    test("keeps nested comments and quotes from changing later coloring (vscode-mssql#1014, #1253, #1571, #1654; azuredatastudio#848, #2026, #7358, #14045, #19205, #22980)", async () => {
        const sql = `-- user's comment
/* outer ' quote /* nested */ still comment */
SELECT dbo.Items.Id FROM dbo.Items;`;
        const { tokens } = await colorize(sql);

        assert.deepEqual(classificationOf(tokens, sql, "SELECT"), {
            type: "keyword",
            modifiers: [],
        });
        assert.deepEqual(classificationOf(tokens, sql, "Items", 1), {
            type: "table",
            modifiers: [],
        });
    });

    test("classifies local and global temp tables as temporary objects (vscode-mssql#530, #725; azuredatastudio#60, #98, #142, #2100)", async () => {
        const sql = "SELECT * FROM #local; SELECT * FROM ##global;";
        const { tokens } = await colorize(sql);

        assert.deepEqual(classificationOf(tokens, sql, "#local"), {
            type: "temporaryTable",
            modifiers: ["temporary"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "##global"), {
            type: "temporaryTable",
            modifiers: ["temporary"],
        });
    });

    test("colors set and query keywords (vscode-mssql#17731; azuredatastudio#1289, #13054, #1372, #835)", async () => {
        const sql = `
CREATE DATABASE AppDb;
SELECT DISTINCT RIGHT(Name, 1) FROM dbo.Items WHERE Id BETWEEN 1 AND 2
EXCEPT
SELECT DISTINCT RIGHT(Name, 1) FROM dbo.Archive;
`;
        const { tokens } = await colorize(sql);

        for (const keyword of ["CREATE", "DATABASE", "DISTINCT", "RIGHT", "BETWEEN", "EXCEPT"]) {
            assert.equal(classificationOf(tokens, sql, keyword)?.type, "keyword");
        }
    });

    test("colors aliases and bracketed identifiers by semantic role (vscode-mssql#1075, #1293, #1575)", async () => {
        const sql = "SELECT [order alias].[Order Id] FROM [Order Details] AS [order alias];";
        const { tokens } = await colorize(sql);

        assert.deepEqual(classificationOf(tokens, sql, "[order alias]", 1), {
            type: "alias",
            modifiers: ["declaration", "quoted"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "[Order Details]"), {
            type: "table",
            modifiers: ["quoted"],
        });
    });

    test("does not start a string after an identifier ending in N (vscode-mssql#21603)", async () => {
        const sql = "SELECT columnN FROM dbo.Items; SELECT 1;";
        const { tokens } = await colorize(sql);

        assert.deepEqual(classificationOf(tokens, sql, "columnN"), {
            type: "column",
            modifiers: [],
        });
        assert.deepEqual(classificationOf(tokens, sql, "SELECT", 1), {
            type: "keyword",
            modifiers: [],
        });
    });

    test("colors historical built-ins and keywords (vscode-mssql#1010, #16955; azuredatastudio#584, #1412, #1937)", async () => {
        const sql = `
REVERT;
ALTER TABLE dbo.Child ADD CONSTRAINT FK_Child_Parent
FOREIGN KEY (ParentId) REFERENCES dbo.Parent(Id) ON UPDATE CASCADE;
SELECT * FROM OPENQUERY(RemoteServer, 'SELECT 1')
FULL OUTER JOIN dbo.Other ON 1 = 1;
`;
        const { tokens } = await colorize(sql);

        for (const keyword of ["REVERT", "ALTER", "UPDATE", "OPENQUERY", "FULL"]) {
            assert.equal(classificationOf(tokens, sql, keyword)?.type, "keyword");
        }
    });

    test("colors keywords in aggregate and DDL contexts (azuredatastudio#131, #138, #1260)", async () => {
        const sql = `
SELECT COUNT(DISTINCT Id) FROM dbo.Items;
CREATE TABLE dbo.Generated (Id int IDENTITY(1, 1));
TRUNCATE TABLE dbo.Generated;
`;
        const { tokens } = await colorize(sql);

        assert.equal(classificationOf(tokens, sql, "COUNT")?.type, "function");
        for (const keyword of ["DISTINCT", "IDENTITY", "TRUNCATE"]) {
            assert.equal(classificationOf(tokens, sql, keyword)?.type, "keyword");
        }
    });

    test("keeps aggregate punctuation from changing later coloring (azuredatastudio#13149, #14070, #1689)", async () => {
        const sql = "SELECT COUNT(*) FROM sys.tables; SELECT 1;";
        const { tokens } = await colorize(sql);

        assert.equal(classificationOf(tokens, sql, "COUNT")?.type, "function");
        assert.equal(classificationOf(tokens, sql, "FROM")?.type, "keyword");
        assert.equal(classificationOf(tokens, sql, "SELECT", 1)?.type, "keyword");
    });

    test("keeps comment markers and quotes inside bracketed identifiers (vscode-mssql#1778; azuredatastudio#557)", async () => {
        const sql = "SELECT [O'Brien], [--name], [/*name*/] FROM dbo.Items; SELECT 1;";
        const { tokens } = await colorize(sql);

        for (const identifier of ["[O'Brien]", "[--name]", "[/*name*/]"]) {
            assert.equal(classificationOf(tokens, sql, identifier)?.type, "column");
        }
        assert.equal(classificationOf(tokens, sql, "SELECT", 1)?.type, "keyword");
    });

    test("classifies complete single-quoted literals as strings (vscode-mssql#17055)", async () => {
        const sql = "SELECT * FROM dbo.Items WHERE Name = 'test' AND Code = \"asd\";";
        const { tokens } = await colorize(sql);

        assert.deepEqual(classificationOf(tokens, sql, "'test'"), {
            type: "string",
            modifiers: [],
        });
    });

    test("colors newer scalar and rowset functions (azuredatastudio#19737, #19756)", async () => {
        const sql = `
SELECT JSON_VALUE('{}', '$.value'), GREATEST(1, 2), LEAST(1, 2), DATE_BUCKET(day, 1, GETDATE());
SELECT value FROM GENERATE_SERIES(1, 3);
`;
        const { tokens } = await colorize(sql);

        for (const name of ["JSON_VALUE", "GREATEST", "LEAST", "DATE_BUCKET", "GENERATE_SERIES"]) {
            assert.equal(classificationOf(tokens, sql, name)?.type, "function");
        }
    });

    test("colors bracketed temp tables and hostile quoted names (azuredatastudio#2745, #300, #4630)", async () => {
        const sql = `
CREATE TABLE [#tempData] ([Id] int);
SELECT * FROM [dbo].[O'Brien];
USE [Verify_Hierarchy_Baseline_Sqlv150'']]]]]];
SELECT 1;
`;
        const { tokens } = await colorize(sql);

        assert.equal(classificationOf(tokens, sql, "[#tempData]")?.type, "temporaryTable");
        assert.equal(classificationOf(tokens, sql, "[O'Brien]")?.type, "table");
        assert.equal(classificationOf(tokens, sql, "SELECT", 1)?.type, "keyword");
    });
});
