-- Purpose: Prepares a table with long VARCHAR(MAX) values, then selects all rows.
-- Tags: sqlserver, varchar-max, long-text, sample-data

IF OBJECT_ID(N'dbo.LongTextTable', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LongTextTable
    (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LongTextTable PRIMARY KEY,
        Label VARCHAR(50) NOT NULL,
        LongText VARCHAR(MAX) NOT NULL,
        CreatedDate DATETIME2(0) NOT NULL CONSTRAINT DF_LongTextTable_CreatedDate DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.LongTextTable)
BEGIN
    INSERT INTO dbo.LongTextTable (Label, LongText)
    VALUES
        ('short', REPLICATE('Short sample. ', 25)),
        ('medium', REPLICATE('Medium length sample text for result-grid wrapping. ', 250)),
        ('large', REPLICATE('Large long-varchar sample text for stress testing display and export. ', 1000));
END;
GO

SELECT *
FROM dbo.LongTextTable;
GO
