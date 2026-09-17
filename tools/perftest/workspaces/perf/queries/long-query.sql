-- Deterministic long-running server-side workload (the cancel target).
WAITFOR DELAY '00:00:20';
SELECT 1 AS Done;
