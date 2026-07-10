/*
    Cloud Deploy — data generator for the Slack messages demo.

    Seeds the dbo.Messages table with representative DUMMY data so the workload
    validator has volume to measure against. Without volume, query latencies are
    sub-millisecond noise and the workload check flaps; with ~50k rows the
    numbers are stable and a real regression (e.g. an un-indexed join) shows up
    as a genuine latency Warning.

    Properties (per decision D-D):
      * DETERMINISTIC — no RAND(); the same rows every run, so a latency change
        means the SCHEMA changed, not the data.
      * VOLUME — 50,000 messages.
      * DISTRIBUTION — spread across 10 channels and 500 users, so a
        WHERE ChannelId = 1 query actually filters a meaningful subset.

    In a real project this is hand-authored by the developer (only they know what
    realistic data looks like for their schema). It runs fresh against the
    throwaway ephemeral database every run, then the database is torn down.
*/
SET NOCOUNT ON;
GO

-- Generate 50,000 deterministic rows via a numbers sequence built from a
-- cross join of the system catalog (no dependency on a numbers table).
;WITH N AS (
    SELECT TOP (50000)
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM sys.all_objects AS a
    CROSS JOIN sys.all_objects AS b
)
INSERT INTO dbo.Messages (MessageId, ChannelId, UserId, Body, PostedAt)
SELECT
    n,
    (n % 10) + 1,                                        -- ChannelId 1..10
    (n % 500) + 1,                                       -- UserId 1..500
    N'Sample message ' + CAST(n AS NVARCHAR(20)),
    DATEADD(SECOND, n, CAST('2026-01-01T00:00:00' AS DATETIME2))
FROM N;
GO
