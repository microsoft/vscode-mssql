-- Purpose: SQL Server catalog smoke query in a folder whose name contains backticks and brackets.
-- Tags: sqlserver, path-handling, catalog, smoke-test

SELECT *
FROM sys.all_objects;
