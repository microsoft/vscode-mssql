-- Purpose: Exercises syntax coloring for temp tables and variable declarations.
-- Tags: sqlserver, colorizer, temp-table, variables

CREATE TABLE #TempTable
(
    ID INT,
    Name NVARCHAR(50)
);

DECLARE @Var1 INT = 10;
DECLARE @Var2 NVARCHAR(50) = 'Test';
