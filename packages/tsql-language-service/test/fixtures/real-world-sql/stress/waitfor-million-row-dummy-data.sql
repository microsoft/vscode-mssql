-- Purpose: Ensures master.dbo.DummyData has at least 1,000,000 rows, then runs delayed selects.
-- Tags: sqlserver, waitfor, sample-data, large-result-set, stress-test
-- Warning: This script can return multiple large result sets.

USE [master];
GO

IF OBJECT_ID(N'dbo.DummyData', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DummyData
    (
        Id INT NOT NULL CONSTRAINT PK_DummyData PRIMARY KEY,
        Name NVARCHAR(100) NOT NULL,
        CreatedDate DATETIME2(0) NOT NULL
    );
END;
GO

DECLARE @TargetRowCount INT = 1000000;
DECLARE @ExistingRowCount INT = (SELECT COUNT(*) FROM dbo.DummyData);
DECLARE @RowsToAdd INT = @TargetRowCount - @ExistingRowCount;
DECLARE @StartId INT = ISNULL((SELECT MAX(Id) FROM dbo.DummyData), 0);

IF @RowsToAdd > 0
BEGIN
    WITH E1(N) AS (
        SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL
        SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
    ),
    E2(N) AS (SELECT 1 FROM E1 a CROSS JOIN E1 b),
    E4(N) AS (SELECT 1 FROM E2 a CROSS JOIN E2 b),
    E8(N) AS (SELECT 1 FROM E4 a CROSS JOIN E4 b),
    RowsToInsert(RowNumber) AS (
        SELECT TOP (@RowsToAdd) ROW_NUMBER() OVER (ORDER BY (SELECT NULL))
        FROM E8
    )
    INSERT INTO dbo.DummyData (Id, Name, CreatedDate)
    SELECT
        CAST(@StartId + RowNumber AS INT),
        CONCAT(N'Dummy ', @StartId + RowNumber),
        DATEADD(SECOND, CAST(RowNumber % 86400 AS INT), CONVERT(DATETIME2(0), '2024-01-01T00:00:00'))
    FROM RowsToInsert;
END;
GO

SELECT [Id], [Name], [CreatedDate]
FROM [master].[dbo].[DummyData];

WAITFOR DELAY '00:00:05';

SELECT [Id], [Name], [CreatedDate]
FROM [master].[dbo].[DummyData];

WAITFOR DELAY '00:00:05';

SELECT [Id], [Name], [CreatedDate]
FROM [master].[dbo].[DummyData];

WAITFOR DELAY '00:00:05';

SELECT [Id], [CreatedDate]
FROM [master].[dbo].[DummyData];

SELECT [Id], [Name], [CreatedDate]
FROM [master].[dbo].[DummyData];
