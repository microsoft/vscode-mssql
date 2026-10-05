-- Provider-neutral deep-row fixture. Preserve the exact DECIMAL(18,4) text
-- while avoiding ts-native exact mode's intentional precision > 15 refusal.
-- The raw numeric column remains covered by its dedicated fidelity oracle.
SELECT
    Id,
    Category,
    Label,
    CONVERT(VARCHAR(32), Amount) AS Amount
FROM dbo.PerfRows100k
ORDER BY Id;
