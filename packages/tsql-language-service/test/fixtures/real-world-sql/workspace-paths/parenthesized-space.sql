-- Purpose: SQL Server catalog smoke query in a folder whose name contains parentheses and spaces.
-- Tags: sqlserver, path-handling, catalog, smoke-test

SELECT *
FROM sys.all_objects;
