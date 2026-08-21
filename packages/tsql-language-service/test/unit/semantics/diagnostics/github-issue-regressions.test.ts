/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { analyzeSql, createMetadata, table } from "../../support/semanticHarness.ts";

suite("GitHub issue semantic-diagnostic regressions", () => {
    test("accepts valid CTE, CREATE OR ALTER, and DROP IF EXISTS forms (azuredatastudio#19776, #15380, #2673)", async () => {
        const diagnostics = await analyzeSql(
            `
WITH Recent AS (SELECT 1 AS Id) SELECT * FROM Recent;
GO
CREATE OR ALTER PROCEDURE dbo.RefreshData AS SELECT 1;
GO
DROP TABLE IF EXISTS dbo.SalesPeople;
`,
            createMetadata({ objects: [table("salespeople", "dbo", "SalesPeople")] }),
        );

        assert.equal(diagnostics.length, 0);
    });

    test("does not count hidden temporal columns in wildcard projections (SqlParser#29)", async () => {
        const diagnostics = await analyzeSql(
            `
WITH SampleCTE AS (
    SELECT *, SysStartTime, SysEndTime
    FROM dbo.SampleTemporalTable
)
SELECT * FROM SampleCTE;
`,
            createMetadata({
                objects: [table("temporal", "dbo", "SampleTemporalTable")],
                columns: new Map([
                    [
                        "temporal",
                        [
                            { name: "Id", typeDisplay: "int" },
                            { name: "SysStartTime", typeDisplay: "datetime2", hidden: true },
                            { name: "SysEndTime", typeDisplay: "datetime2", hidden: true },
                        ],
                    ],
                ]),
            }),
        );

        assert.equal(
            diagnostics.some(({ code }) => code === "MSSQL8156"),
            false,
        );
    });

    test("does not report a locally created temp table as invalid (azuredatastudio#19820)", async () => {
        const diagnostics = await analyzeSql(
            `
CREATE TABLE #Orders (OrderId int NOT NULL);
INSERT INTO #Orders (OrderId) VALUES (1);
SELECT OrderId FROM #Orders;
`,
            createMetadata(),
        );

        assert.equal(
            diagnostics.some(
                ({ code, message }) =>
                    code === "MSSQL208" && message.includes("Invalid object name '#Orders'"),
            ),
            false,
        );
    });

    test("recognizes $action in a MERGE OUTPUT clause (SqlParser#1, vscode-mssql#20411, #22356)", async () => {
        const diagnostics = await analyzeSql(
            `
CREATE TABLE #Target (Id int NOT NULL);
CREATE TABLE #Source (Id int NOT NULL);
MERGE #Target AS target
USING #Source AS source ON target.Id = source.Id
WHEN NOT MATCHED THEN INSERT (Id) VALUES (source.Id)
OUTPUT $action;
`,
            createMetadata(),
        );

        assert.equal(
            diagnostics.some(
                ({ code, message }) =>
                    code === "MSSQL207" && message.includes("Invalid column name '$action'"),
            ),
            false,
        );
    });

    test("tracks a catalog column added earlier in the script (vscode-mssql#19632)", async () => {
        const diagnostics = await analyzeSql(
            `
ALTER TABLE Inventory.Furniture ADD Subcategory varchar(50) NULL;
GO
UPDATE Inventory.Furniture SET Subcategory = 'General' WHERE Subcategory IS NULL;
`,
            createMetadata({
                schemas: [{ database: "db", name: "Inventory" }],
                objects: [table("furniture", "Inventory", "Furniture")],
                columns: new Map([["furniture", [{ name: "FurnitureId", typeDisplay: "int" }]]]),
            }),
        );

        assert.equal(
            diagnostics.some(
                ({ code, message }) => code === "MSSQL207" && message.includes("Subcategory"),
            ),
            false,
        );
    });

    test("allows the same temp-table name in mutually exclusive branches (SqlParser#3)", async () => {
        const diagnostics = await analyzeSql(
            `
IF @UseCurrent = 1
    SELECT Id INTO #Items FROM dbo.CurrentItems;
ELSE
    SELECT Id INTO #Items FROM dbo.ArchivedItems;
SELECT Id FROM #Items;
`,
            createMetadata({
                objects: [
                    table("current", "dbo", "CurrentItems"),
                    table("archived", "dbo", "ArchivedItems"),
                ],
                columns: new Map([
                    ["current", [{ name: "Id", typeDisplay: "int" }]],
                    ["archived", [{ name: "Id", typeDisplay: "int" }]],
                ]),
            }),
        );

        assert.equal(
            diagnostics.some(({ message }) => message.includes("already an object named '#Items'")),
            false,
        );
    });

    test("accepts FileStream member methods (SqlParser#10)", async () => {
        const diagnostics = await analyzeSql(
            `
SELECT [file_stream].GetFileNamespacePath(1)
FROM dbo.Documents;
`,
            createMetadata({
                objects: [table("documents", "dbo", "Documents")],
                columns: new Map([
                    ["documents", [{ name: "file_stream", typeDisplay: "varbinary(max)" }]],
                ]),
            }),
        );

        assert.equal(
            diagnostics.some(({ code }) => code === "NotRecognizedFunctionName"),
            false,
        );
    });

    test("recognizes TRANSLATE and OPENJSON built-ins (azuredatastudio#2715, #4815, #15697)", async () => {
        const diagnostics = await analyzeSql(
            `
DECLARE @json nvarchar(max) = N'{"value":"abc"}';
SELECT TRANSLATE(value, 'abc', 'xyz')
FROM OPENJSON(@json) WITH (value nvarchar(20) '$.value');
`,
            createMetadata(),
        );

        assert.equal(
            diagnostics.some(({ code }) =>
                ["NotRecognizedFunctionName", "MSSQL208"].includes(code),
            ),
            false,
        );
    });

    test("allows omitted stored-procedure parameters with defaults (azuredatastudio#1024)", async () => {
        const diagnostics = await analyzeSql(
            "EXEC dbo.ProcessItem @ItemId = 42;",
            createMetadata({
                objects: [
                    {
                        ref: { id: "process-item", database: "db" },
                        database: "db",
                        schema: "dbo",
                        name: "ProcessItem",
                        kind: "procedure",
                    },
                ],
                parameters: new Map([
                    [
                        "process-item",
                        [
                            {
                                ordinal: 1,
                                name: "@ItemId",
                                typeDisplay: "int",
                                hasDefault: false,
                            },
                            {
                                ordinal: 2,
                                name: "@Message",
                                typeDisplay: "nvarchar(100)",
                                hasDefault: true,
                            },
                        ],
                    ],
                ]),
            }),
        );

        assert.equal(
            diagnostics.some(({ code }) => code === "InsufficientArguments"),
            false,
        );
    });

    test("accepts valid catalog columns in UPDATE statements (azuredatastudio#3055)", async () => {
        const diagnostics = await analyzeSql(
            "UPDATE dbo.Items SET Name = 'updated' WHERE Id = 1;",
            createMetadata({
                objects: [table("items", "dbo", "Items")],
                columns: new Map([
                    [
                        "items",
                        [
                            { name: "Id", typeDisplay: "int" },
                            { name: "Name", typeDisplay: "nvarchar(100)" },
                        ],
                    ],
                ]),
            }),
        );

        assert.equal(
            diagnostics.some(({ code }) => code === "MSSQL207"),
            false,
        );
    });

    test("leaves remote four-part object names to the linked server (SqlParser#4; azuredatastudio#19253, #19886, #2193)", async () => {
        const diagnostics = await analyzeSql(
            "SELECT * FROM RemoteServer.RemoteDb.dbo.Items;",
            createMetadata(),
        );

        assert.equal(
            diagnostics.some(({ code }) => code === "MSSQL208"),
            false,
        );
    });
});
