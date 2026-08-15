-- Purpose: SQL Server catalog smoke query in a folder whose name contains percent-encoded spaces.
-- Tags: sqlserver, path-handling, catalog, smoke-test

SELECT *
FROM sys.all_objects;
