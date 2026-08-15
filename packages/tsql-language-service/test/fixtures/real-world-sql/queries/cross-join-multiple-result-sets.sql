-- Purpose: Tests table rendering with three bounded cross-join result sets.
-- Tags: sqlserver, cross-join, multiple-result-sets, result-grid

SELECT TOP 1000 *
FROM sys.objects AS o1
CROSS JOIN sys.objects AS o2
CROSS JOIN sys.objects AS o3;

SELECT TOP 1000 *
FROM sys.objects AS o1
CROSS JOIN sys.objects AS o2
CROSS JOIN sys.objects AS o3;

SELECT TOP 1000 *
FROM sys.objects AS o1
CROSS JOIN sys.objects AS o2
CROSS JOIN sys.objects AS o3;
