/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import type { TsqlFeatureProfile } from "../../../../src/index.ts";
import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("github-issue-regressions.sql");
const synapseProfile: TsqlFeatureProfile = {
    engineProfile: "azure-synapse-dedicated",
    serverMajorVersion: 13,
    compatibilityLevel: 130,
    previewFeatures: false,
};

suite("GitHub issue syntax regressions", () => {
    test("explains a missing SELECT list after TOP (azuredatastudio#4941)", () => {
        const diagnostics = parse("SELECT TOP 100 FROM dbo.Users;").diagnostics;

        assert.equal(diagnostics.length, 1);
        assert.equal(
            diagnostics[0]?.message,
            "A SELECT list is required after TOP. Specify columns or add * before FROM.",
        );
    });

    test("parses IGNORE NULLS window functions (SqlParser#2)", () => {
        assertValid(`
SELECT FIRST_VALUE(Measure) IGNORE NULLS OVER (ORDER BY Id) FROM dbo.Samples;
SELECT LAST_VALUE(Measure) IGNORE NULLS OVER (ORDER BY Id) FROM dbo.Samples;
SELECT LAG(Measure) IGNORE NULLS OVER (ORDER BY Id) FROM dbo.Samples;
SELECT LEAD(Measure) IGNORE NULLS OVER (ORDER BY Id) FROM dbo.Samples;
`);
    });

    test("parses graph edge constraints and shortest paths (SqlParser#5)", () => {
        assertValid(`
CREATE TABLE [core].[isClass] (
    CONSTRAINT [EC_thing_is_classification]
        CONNECTION ([core].[thing] TO [core].[classification])
) AS EDGE;

SELECT *
FROM [core].[thing] AS thing,
     [core].[isClass] FOR PATH AS isClass,
     [core].[classification] FOR PATH AS classification
WHERE MATCH(SHORTEST_PATH(thing(-(isClass)->classification)+));
`);
    });

    test("parses CREATE OR ALTER modules (SqlParser#7, azuredatastudio#264, #4746, #7745, #8882, #13329)", () => {
        assertValid(`
CREATE OR ALTER PROCEDURE dbo.DoSomething
AS
    SELECT 1;
`);
    });

    test("parses distributed CTAS statements (SqlParser#8, #9, #16, #31; vscode-mssql#1707, #17778)", () => {
        assertValid(
            `
CREATE TABLE dbo.DistributedOrders
WITH (DISTRIBUTION = HASH(CustomerId), CLUSTERED COLUMNSTORE INDEX)
AS
SELECT CustomerId, OrderId FROM dbo.Orders;
`,
            synapseProfile,
        );
    });

    test("parses FOR JSON PATH queries (SqlParser#12, vscode-mssql#1519, azuredatastudio#2953, #17056)", () => {
        assertValid(`
SELECT Id, Name
FROM dbo.Items
FOR JSON PATH, INCLUDE_NULL_VALUES, ROOT('items');
`);
    });

    test("parses temporal sources after derived-table joins (SqlParser#13; azuredatastudio#7526, #7888)", () => {
        assertValid(`
SELECT a.*, b.*, c.*
FROM tt_table FOR SYSTEM_TIME ALL AS a
LEFT OUTER JOIN (
    SELECT b1.* FROM tt_table AS b1
) AS b ON b.foo = a.foo
LEFT OUTER JOIN tt_table FOR SYSTEM_TIME ALL AS c ON c.foo = a.foo;
`);
    });

    test("parses partition function calls (SqlParser#15, azuredatastudio#3770, #15222, #23714)", () => {
        assertValid(`
SELECT $PARTITION.PartitionByDate(OrderDate)
FROM dbo.Orders;
`);
    });

    test("parses CHANGETABLE FORCESEEK parameters (SqlParser#24)", () => {
        assertValid(`
SELECT change.*
FROM CHANGETABLE(CHANGES dbo.Orders, 10, FORCESEEK) AS change;
`);
    });

    test("parses WAIT_STATS_CAPTURE_MODE query-store options (SqlParser#26)", () => {
        assertValid(`
ALTER DATABASE ApplicationDb
SET QUERY_STORE (WAIT_STATS_CAPTURE_MODE = ON);
`);
    });

    test("parses THROW in TRY CATCH IF ELSE blocks (SqlParser#27, vscode-mssql#22353, azuredatastudio#1643)", () => {
        assertValid(`
CREATE OR ALTER PROCEDURE dbo.ThrowExample
AS
BEGIN
    BEGIN TRY
        SELECT 1;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 50000
            THROW;
        ELSE
            THROW 51000, 'Unexpected error', 1;
    END CATCH;
END;
`);
    });

    test("parses parenthesized OPENROWSET BULK sources in views (SqlParser#30)", () => {
        assertValid(`
CREATE VIEW dbo.ExternalRows
AS
SELECT rows.Id
FROM OPENROWSET(
    BULK ('https://example.blob.core.windows.net/data/*.parquet'),
    FORMAT = 'PARQUET'
) AS rows;
`);
    });

    test("parses inline indexes with included columns (SqlParser#32)", () => {
        assertValid(`
CREATE TABLE dbo.InlineIndex (
    Id int NOT NULL,
    Name nvarchar(100),
    INDEX IX_InlineIndex_Id (Id) INCLUDE (Name)
);
`);
    });

    test("parses FORCESCAN table hints (SqlParser#33)", () => {
        assertValid(`
SELECT * FROM dbo.Orders WITH (FORCESCAN);
`);
    });

    test("parses OPENROWSET CSV options (SqlParser#34, azuredatastudio#25053)", () => {
        assertValid(`
SELECT rows.*
FROM OPENROWSET(
    BULK 'https://example.blob.core.windows.net/data/*.csv',
    FORMAT = 'CSV',
    PARSER_VERSION = '2.0',
    HEADER_ROW = TRUE
) AS rows;
`);
    });

    test("parses STRING_SPLIT rowsets (azuredatastudio#8783, #17960)", () => {
        assertValid(`
SELECT split.value
FROM STRING_SPLIT('one,two,three', ',') AS split;
`);
    });

    test("parses DROP TABLE IF EXISTS (azuredatastudio#2712, #13431, #13814)", () => {
        assertValid(`
DROP TABLE IF EXISTS #EmployeeIDs;
CREATE TABLE #EmployeeIDs (EmployeeID int NOT NULL);
`);
    });

    test("parses AT TIME ZONE expressions (azuredatastudio#6827)", () => {
        assertValid(`
SELECT CreatedAt AT TIME ZONE 'UTC'
FROM dbo.Events;
`);
    });

    test("parses NOT ENFORCED constraints (azuredatastudio#16859)", () => {
        assertValid(`
CREATE TABLE dbo.DistributedItems (
    Id int NOT NULL,
    CONSTRAINT PK_DistributedItems PRIMARY KEY NONCLUSTERED (Id) NOT ENFORCED
);
`);
    });

    test("parses repeat counts on GO batch separators (azuredatastudio#7842)", () => {
        assertValid(`
SELECT 1;
GO 10
SELECT 2;
`);
    });

    test("parses encrypted ALTER COLUMN definitions (azuredatastudio#12228)", () => {
        assertValid(`
ALTER TABLE dbo.BatchParameterization
ALTER COLUMN unique_key uniqueidentifier ENCRYPTED WITH (
    COLUMN_ENCRYPTION_KEY = CEK_CERT_v2,
    ENCRYPTION_TYPE = DETERMINISTIC,
    ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'
) NOT NULL;
`);
    });

    test("parses CONCAT calls (vscode-mssql#849)", () => {
        assertValid(`
SELECT CONCAT(FirstName, ' ', LastName)
FROM dbo.People;
`);
    });

    test("parses ALTER TABLE ADD columns (SqlParser#25, azuredatastudio#13643)", () => {
        assertValid(`
ALTER TABLE dbo.Items ADD Description nvarchar(200) NULL;
`);
    });

    test("parses scalar subqueries inside COALESCE (SqlParser#36)", () => {
        assertValid(`
SELECT COALESCE((SELECT TOP 1 Value FROM dbo.Items), 2);
`);
    });

    test("parses Azure database edition options (vscode-mssql#658)", () => {
        assertValid(`
CREATE DATABASE TestDW (EDITION = 'datawarehouse', SERVICE_OBJECTIVE = 'DW100');
`);
    });

    test("parses method calls on FileStream columns (SqlParser#10)", () => {
        assertValid(`
SELECT [file_stream].GetFileNamespacePath(1)
FROM dbo.Documents;
`);
    });

    test("parses temporal table ALTER statements (azuredatastudio#14461)", () => {
        assertValid(`
ALTER TABLE dbo.Items SET (SYSTEM_VERSIONING = OFF);
ALTER TABLE dbo.Items DROP PERIOD FOR SYSTEM_TIME;
`);
    });

    test("parses generated primary-key index options (azuredatastudio#2617, #20317)", () => {
        assertValid(`
ALTER TABLE dbo.Items ADD CONSTRAINT PK_Items PRIMARY KEY CLUSTERED (Id ASC)
WITH (
    PAD_INDEX = OFF,
    STATISTICS_NORECOMPUTE = OFF,
    SORT_IN_TEMPDB = OFF,
    IGNORE_DUP_KEY = OFF,
    ONLINE = OFF,
    ALLOW_ROW_LOCKS = ON,
    ALLOW_PAGE_LOCKS = ON
) ON [PRIMARY];
`);
    });

    test("parses four-argument DATE_BUCKET calls (azuredatastudio#13069)", () => {
        assertValid(`
DECLARE @date datetime2(0) = '2020-04-15 21:22:11';
DECLARE @origin datetime2(0) = '2020-01-01';
SELECT DATE_BUCKET(week, 1, @date, @origin);
`);
    });

    test("parses TRANSLATE calls (azuredatastudio#2715, #4815)", () => {
        assertValid(`
SELECT TRANSLATE('2*[3+4]/{7-2}', '[]{}', '()()');
`);
    });

    test("parses CREATE DATABASE SCOPED CREDENTIAL (azuredatastudio#4298)", () => {
        assertValid(`
CREATE DATABASE SCOPED CREDENTIAL AzureStorageCredential
WITH IDENTITY = 'asc', SECRET = '<storagekey>';
`);
    });

    test("parses FIRST_ROW external file-format options (azuredatastudio#3453)", () => {
        assertValid(`
CREATE EXTERNAL FILE FORMAT CsvFormat
WITH (
    FORMAT_TYPE = DELIMITEDTEXT,
    FORMAT_OPTIONS (
        FIELD_TERMINATOR = ',',
        STRING_DELIMITER = '"',
        FIRST_ROW = 2
    )
);
`);
    });

    test("parses named window clauses (azuredatastudio#20327)", () => {
        assertValid(`
SELECT
    LAG(Value) OVER RecentRows,
    LAG(OtherValue) OVER RecentRows
FROM dbo.Items
WINDOW RecentRows AS (ORDER BY CreatedAt);
`);
    });
});
