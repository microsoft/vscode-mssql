-- Purpose: Emits employee result sets, many messages, and optional AdventureWorks person result sets.
-- Tags: sqlserver, result-grid, messages, sample-data, adventureworks-optional

IF DB_ID(N'TestData_1M') IS NULL
BEGIN
    CREATE DATABASE TestData_1M;
END;
GO

USE [TestData_1M];
GO

IF OBJECT_ID(N'dbo.EmployeeData', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeData
    (
        ID INT NOT NULL CONSTRAINT PK_EmployeeData PRIMARY KEY,
        Name NVARCHAR(100) NOT NULL,
        Email NVARCHAR(255) NOT NULL,
        Department NVARCHAR(50) NOT NULL,
        Salary DECIMAL(12,2) NOT NULL
    );
END;
GO

IF (SELECT COUNT(*) FROM dbo.EmployeeData) < 500
BEGIN
    TRUNCATE TABLE dbo.EmployeeData;

    WITH E1(N) AS (
        SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL
        SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
    ),
    E2(N) AS (SELECT 1 FROM E1 a CROSS JOIN E1 b),
    E4(N) AS (SELECT 1 FROM E2 a CROSS JOIN E2 b),
    RowsToInsert(RowNumber) AS (
        SELECT TOP (500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL))
        FROM E4
    )
    INSERT INTO dbo.EmployeeData (ID, Name, Email, Department, Salary)
    SELECT
        RowNumber,
        CONCAT(N'Employee ', RowNumber),
        CONCAT(N'employee', RowNumber, N'@example.test'),
        CHOOSE((RowNumber % 5) + 1, N'Engineering', N'Sales', N'Finance', N'Operations', N'Support'),
        50000 + ((RowNumber % 75) * 1000)
    FROM RowsToInsert;
END;
GO

SELECT TOP 500
    [ID],
    [Name],
    [Email],
    [Department],
    [Salary],
    [Name] AS [Name2],
    [Email] AS [Email2],
    [Department] AS [Department2],
    [Salary] AS [Salary2]
FROM [TestData_1M].[dbo].[EmployeeData];

SELECT TOP 500
    [ID],
    [Name],
    [Email],
    [Department],
    [Salary]
FROM [TestData_1M].[dbo].[EmployeeData];

SELECT TOP 500
    [ID],
    [Name],
    [Email],
    [Department],
    [Salary]
FROM [TestData_1M].[dbo].[EmployeeData];

DECLARE @i INT = 0;

WHILE @i < 1000
BEGIN
    PRINT 'lol';
    SET @i = @i + 1;
END;

IF DB_ID(N'AdventureWorks2022') IS NOT NULL
BEGIN
    EXEC(N'
        SELECT *
        FROM [AdventureWorks2022].[Person].[Person];

        SELECT *
        FROM [AdventureWorks2022].[Person].[Person];
    ');
END
ELSE
BEGIN
    PRINT 'AdventureWorks2022 is not installed; skipping Person.Person result sets.';
END;
