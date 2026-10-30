-- Run once in a scratch database with native vector support.
-- Synthetic numerical data; no external model or index is created.
CREATE TABLE dbo.VectorSamples (
    id int NOT NULL PRIMARY KEY,
    title nvarchar(100),
    category nvarchar(30),
    body nvarchar(max),
    embedding vector(64)
);

WITH numbers AS (
    SELECT value AS id FROM GENERATE_SERIES(0, 127)
), dimensions AS (
    SELECT value AS dim FROM GENERATE_SERIES(1, 64)
)
INSERT dbo.VectorSamples (id, title, category, body, embedding)
SELECT n.id, CONCAT(t.topic, ' sample ', n.id), t.topic,
    REPLICATE(CONVERT(nvarchar(max), CONCAT('A synthetic ', t.topic,
        ' example for exploring vector search. Sample ', n.id,
        ' uses deterministic values so this preview can be reproduced. ')), 8),
    CAST(CONCAT('[', v.components, ']') AS vector(64))
FROM numbers AS n
JOIN (VALUES (0, N'Travel'), (1, N'Music'), (2, N'Cooking'), (3, N'Science')) AS t(groupId, topic)
    ON t.groupId = n.id % 4
CROSS APPLY (
    SELECT STRING_AGG(CONVERT(nvarchar(max), CONVERT(decimal(12,6),
        SIN((t.groupId + 1) * dim * 0.15) + 0.12 * COS((n.id + 1) * dim * 0.04))), ',')
        WITHIN GROUP (ORDER BY dim) AS components
    FROM dimensions
) AS v;

SELECT id, title, category, body, embedding FROM dbo.VectorSamples ORDER BY id;
