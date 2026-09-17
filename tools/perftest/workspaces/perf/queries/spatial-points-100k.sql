WITH n AS
(
    SELECT TOP (100000)
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS ordinal
    FROM sys.all_objects AS a
    CROSS JOIN sys.all_objects AS b
)
SELECT
    ordinal,
    CONCAT(N'Point ', ordinal) AS label,
    ordinal % 24 AS category,
    geometry::Point(CONVERT(float, ordinal % 1000), CONVERT(float, ordinal / 1000), 0) AS shape
FROM n
ORDER BY ordinal;
