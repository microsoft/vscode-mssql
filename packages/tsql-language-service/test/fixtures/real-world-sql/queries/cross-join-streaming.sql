-- Purpose: Tests result-set streaming and table rendering with a very large cross-join result.
-- Tags: sqlserver, cross-join, streaming, large-result-set, stress-test
-- Warning: This query is intentionally unbounded and can produce an enormous result set.

SELECT *
FROM sys.objects AS o1
CROSS JOIN sys.objects AS o2
CROSS JOIN sys.objects AS o3
CROSS JOIN sys.objects AS o4;
