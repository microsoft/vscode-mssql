-- Purpose: Demonstrates line-number handling for an error thrown from a stored procedure.
-- Tags: sqlserver, error, throw, stored-procedure, repro

-- 1
SELECT 'padding 1';
-- 3
SELECT 'padding 2';
-- 5
GO

-- 7
CREATE OR ALTER PROC dbo.LineNumberDemo
AS
BEGIN
-- 11
THROW 50000, 'Demo failure', 1;
END
GO

-- 16
EXEC dbo.LineNumberDemo;
GO
