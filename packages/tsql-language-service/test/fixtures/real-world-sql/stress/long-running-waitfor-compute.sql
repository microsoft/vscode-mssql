-- Purpose: Runs a deliberate 10-minute delay followed by a synthetic CTE count workload.
-- Tags: sqlserver, waitfor, compute, long-running, stress-test
-- Warning: This script is intentionally long-running.

WAITFOR DELAY '00:10:00';

WITH E1(N) AS (
    SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL
    SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL
    SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
),
E2(N) AS (SELECT 1 FROM E1 a, E1 b),
E4(N) AS (SELECT 1 FROM E2 a, E2 b),
E8(N) AS (SELECT 1 FROM E4 a, E4 b)
SELECT COUNT(*)
FROM E8;
