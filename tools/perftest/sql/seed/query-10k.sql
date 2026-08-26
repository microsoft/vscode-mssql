-- The query-10k-results scenario fixture: returns exactly 10,000 rows with a
-- deterministic order. The results grid must report rowCount == 10000 or the
-- rep is invalid.
SELECT Id, Category, Label, Amount, CreatedOn, Payload
FROM dbo.PerfRows
ORDER BY Id;
