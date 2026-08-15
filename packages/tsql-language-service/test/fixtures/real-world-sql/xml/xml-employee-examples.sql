-- Purpose: Prepares employee sample data, then demonstrates several SQL Server FOR XML query shapes.
-- Tags: sqlserver, xml, result-grid, sample-data

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

IF (SELECT COUNT(*) FROM dbo.EmployeeData) < 25
BEGIN
    TRUNCATE TABLE dbo.EmployeeData;

    WITH RowsToInsert(RowNumber) AS (
        SELECT TOP (100) ROW_NUMBER() OVER (ORDER BY (SELECT NULL))
        FROM sys.objects AS o1
        CROSS JOIN sys.objects AS o2
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

SELECT TOP 10
    ID,
    Name,
    Email,
    Department,
    Salary
FROM dbo.EmployeeData
FOR XML AUTO;

SELECT TOP 5
    ID AS [Employee/@EmployeeID],
    Name AS [Employee/FullName],
    Email AS [Employee/EmailAddress],
    Department AS [Employee/Department],
    Salary AS [Employee/Salary]
FROM dbo.EmployeeData
FOR XML PATH(''), ROOT('Employees');

SELECT
    Department AS [@DepartmentName],
    COUNT(*) AS [@TotalEmployees],
    AVG(Salary) AS [@AverageSalary],
    (
        SELECT TOP 3
            Name AS [@Name],
            Email AS [@Email],
            Salary AS [@Salary]
        FROM dbo.EmployeeData AS e2
        WHERE e2.Department = e1.Department
        ORDER BY Salary DESC
        FOR XML PATH('Employee'), TYPE
    ) AS [TopEmployees]
FROM dbo.EmployeeData AS e1
GROUP BY Department
FOR XML PATH('Department'), ROOT('CompanyData');

SELECT
    'Company Employee Report' AS [Report/@Title],
    GETDATE() AS [Report/@GeneratedDate],
    (
        SELECT
            Department AS [@Name],
            COUNT(*) AS [@Count],
            (
                SELECT
                    ID AS [@ID],
                    Name AS [PersonalInfo/@FullName],
                    Email AS [PersonalInfo/@Email],
                    Salary AS [EmploymentInfo/@Salary],
                    CASE
                        WHEN Salary >= 100000 THEN 'Senior'
                        WHEN Salary >= 70000 THEN 'Mid-Level'
                        ELSE 'Junior'
                    END AS [EmploymentInfo/@Level]
                FROM dbo.EmployeeData AS emp
                WHERE emp.Department = dept.Department
                  AND emp.ID <= 10
                FOR XML PATH('Employee'), TYPE
            )
        FROM (SELECT DISTINCT Department FROM dbo.EmployeeData) AS dept
        FOR XML PATH('Department'), TYPE
    )
FOR XML PATH(''), ROOT('EnterpriseReport');

SELECT TOP 5
    ID AS [@EmployeeID],
    CONCAT('Employee: ', Name, ' works in ', Department) AS [Description],
    Name AS [Contact/Name],
    Email AS [Contact/Email],
    Department AS [Position/Department],
    CONCAT('$', FORMAT(Salary, 'N2')) AS [Position/Salary]
FROM dbo.EmployeeData
FOR XML PATH('Employee'), ROOT('EmployeeDirectory');

SELECT
    (
        SELECT
            ID,
            Name,
            Email,
            Department,
            Salary
        FROM dbo.EmployeeData
        WHERE Department = 'Engineering'
          AND ID <= 25
        FOR XML RAW('EngineeringEmployee'), ELEMENTS
    ) AS XMLData;
