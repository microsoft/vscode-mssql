-- Provider-neutral A/B fixture. The raw PerfRows.Amount column is
-- DECIMAL(18,4); ts-native exact mode intentionally rejects decimal/numeric
-- precision above 15 rather than silently rounding it through JavaScript.
-- Keep that fidelity policy covered by its dedicated oracle, while this
-- transport/render comparison sends the same exact text value through both
-- providers.
SELECT
    Id,
    Category,
    Label,
    CONVERT(VARCHAR(32), Amount) AS Amount,
    CreatedOn,
    Payload
FROM dbo.PerfRows
ORDER BY Id;
