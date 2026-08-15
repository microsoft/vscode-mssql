-- Purpose: Creates and queries a runtime temp table with up to 1,000,000 cells.
-- Tags: sqlserver, temp-table, large-result-set, release-validation, stress-test
-- Warning: Generates 100,000 rows x 10 columns.

-- Create temp table
CREATE TABLE #LargeDataset (
    RowId INT PRIMARY KEY,
    Column1 INT,
    Column2 NVARCHAR(50),
    Column3 DECIMAL(10,2),
    Column4 DATETIME,
    Column5 BIT,
    Column6 UNIQUEIDENTIFIER,
    Column7 NVARCHAR(100),
    Column8 INT,
    Column9 DECIMAL(18,4),
    Column10 NVARCHAR(255)
);

-- Generate 100,000 rows using a cross join technique
INSERT INTO #LargeDataset (RowId, Column1, Column2, Column3, Column4, Column5, Column6, Column7, Column8, Column9, Column10)
SELECT TOP 100000
    ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowId,
    ABS(CHECKSUM(NEWID())) % 10000 AS Column1,
    'Value_' + CAST(ABS(CHECKSUM(NEWID())) % 1000 AS NVARCHAR(50)) AS Column2,
    CAST(ABS(CHECKSUM(NEWID())) % 100000 AS DECIMAL(10,2)) / 100 AS Column3,
    DATEADD(DAY, -(ABS(CHECKSUM(NEWID())) % 3650), GETDATE()) AS Column4,
    ABS(CHECKSUM(NEWID())) % 2 AS Column5,
    NEWID() AS Column6,
    'Description_' + CAST(ABS(CHECKSUM(NEWID())) % 5000 AS NVARCHAR(100)) AS Column7,
    ABS(CHECKSUM(NEWID())) % 50000 AS Column8,
    CAST(ABS(CHECKSUM(NEWID())) % 1000000 AS DECIMAL(18,4)) / 100 AS Column9,
    'LongText_' + REPLICATE('X', ABS(CHECKSUM(NEWID())) % 50) AS Column10
FROM sys.all_objects a
CROSS JOIN sys.all_objects b;

-- Show table statistics
SELECT
    COUNT(*) AS TotalRows,
    COUNT(*) * 10 AS TotalCells
FROM #LargeDataset;

-- Sample query: Select first 100 rows
SELECT TOP 100 *
FROM #LargeDataset
ORDER BY RowId;

-- Aggregation query
SELECT
    Column5,
    COUNT(*) AS RecordCount,
    AVG(Column1) AS AvgColumn1,
    MIN(Column3) AS MinColumn3,
    MAX(Column3) AS MaxColumn3,
    AVG(Column9) AS AvgColumn9
FROM #LargeDataset
GROUP BY Column5;

-- Filtering and sorting query
SELECT TOP 1000
    RowId,
    Column1,
    Column2,
    Column3,
    Column4
FROM #LargeDataset
WHERE Column1 > 5000
    AND Column5 = 1
ORDER BY Column3 DESC;


SELECT *
FROM #LargeDataset;

-- Cleanup
DROP TABLE #LargeDataset;
