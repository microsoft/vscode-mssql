-- Purpose: Prepares employee sample data, then emits repeated employee and scalar result sets.
-- Tags: sqlserver, result-grid, multiple-result-sets, sample-data

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

SELECT 1;
SELECT 2;
SELECT 3;
SELECT 4;
SELECT 5;

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
    [Salary],
    [Name] AS [Name2],
    [Email] AS [Email2],
    [Department] AS [Department2],
    [Salary] AS [Salary2]
FROM [TestData_1M].[dbo].[EmployeeData];

SELECT 6;
