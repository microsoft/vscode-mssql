-- Basic CREATE FUNCTION ... AS EXTERNAL FUNCTION
CREATE FUNCTION dbo.MyExternalFn AS EXTERNAL FUNCTION mySet.myFn;
GO

-- ALTER FUNCTION ... AS EXTERNAL FUNCTION
ALTER FUNCTION dbo.MyExternalFn AS EXTERNAL FUNCTION mySet.anotherFn;
GO

-- CREATE OR ALTER FUNCTION ... AS EXTERNAL FUNCTION
CREATE OR ALTER FUNCTION dbo.MyExternalFn AS EXTERNAL FUNCTION mySet.myFn;
GO

-- Single-part external name
CREATE FUNCTION MyFn AS EXTERNAL FUNCTION myFn;
GO

-- CREATE with RETURNS clause specifying explicit return type
CREATE FUNCTION dbo.MyExternalFn RETURNS MONEY AS EXTERNAL FUNCTION mySet.myFn;
GO

-- ALTER with RETURNS clause
ALTER FUNCTION dbo.MyExternalFn RETURNS NVARCHAR(100) AS EXTERNAL FUNCTION mySet.myFn;
GO

-- CREATE OR ALTER with RETURNS clause
CREATE OR ALTER FUNCTION dbo.MyExternalFn RETURNS INT AS EXTERNAL FUNCTION mySet.myFn;
GO

-- CREATE with single parameter
CREATE FUNCTION dbo.MyExternalFn (@x INT) AS EXTERNAL FUNCTION mySet.myFn;
GO

-- CREATE with multiple parameters and RETURNS
CREATE FUNCTION dbo.MyExternalFn (@x INT, @y NVARCHAR(50)) RETURNS INT AS EXTERNAL FUNCTION mySet.myFn;
GO

-- ALTER with parameters and RETURNS
ALTER FUNCTION dbo.MyExternalFn (@x INT) RETURNS BIGINT AS EXTERNAL FUNCTION mySet.myFn;
GO

-- CREATE OR ALTER with parameters and RETURNS
CREATE OR ALTER FUNCTION dbo.MyExternalFn (@x INT) RETURNS INT AS EXTERNAL FUNCTION mySet.myFn;
GO

-- DROP FUNCTION (existing syntax, no change needed)
DROP FUNCTION dbo.MyExternalFn;
GO

-- DML: invoking the external function like a regular UDF
SELECT dbo.MyExternalFn();
GO

SELECT dbo.MyExternalFn(42, N'hello');
GO

DECLARE @v INT = 1;
SELECT dbo.MyExternalFn(@v, 'const');
GO

SELECT dbo.MyExternalFn(t.col1, t.col2) AS r
FROM dbo.t AS t;
GO
