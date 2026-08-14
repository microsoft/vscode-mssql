SELECT 1
WHERE REGEXP_LIKE ('abc', '^a');

SELECT 1
WHERE NOT REGEXP_LIKE ('abc', '^b');

SELECT IIF (REGEXP_LIKE ('abc', '^a'), 1, 0) AS is_match;

SELECT IIF (NOT REGEXP_LIKE ('abc', '^a'), 1, 0) AS is_match;

-- Test REGEXP_LIKE inside IIF with parentheses (should be scalar parentheses)
SELECT (IIF (REGEXP_LIKE ('abc', '^a'), 'Match', 'No Match')) AS result;

SELECT CASE WHEN REGEXP_LIKE ('abc', '^a') THEN 1 ELSE 0 END AS is_match;

SELECT CASE WHEN NOT REGEXP_LIKE ('abc', '^a') THEN 1 ELSE 0 END AS is_match;

SELECT 1
WHERE REGEXP_LIKE ('abc', '^a', 'i');

SELECT 1
WHERE NOT REGEXP_LIKE ('abc', '^b', 'i');

SELECT IIF (REGEXP_LIKE ('abc', '^a', 'i'), 1, 0) AS is_match;

SELECT IIF (NOT REGEXP_LIKE ('abc', '^a', 'i'), 1, 0) AS is_match;

SELECT CASE WHEN REGEXP_LIKE ('abc', '^a', 'i') THEN 1 ELSE 0 END AS is_match;

SELECT CASE WHEN NOT REGEXP_LIKE ('abc', '^a', 'i') THEN 1 ELSE 0 END AS is_match;

SELECT CASE WHEN NOT REGEXP_LIKE ('abc', '^a', NULL) THEN 1 ELSE 0 END AS is_match;

SELECT CASE WHEN REGEXP_LIKE (NULL, '^a', 'c') THEN 1 ELSE 0 END AS is_match;

SELECT IIF (NOT REGEXP_LIKE ('abc', NULL), 1, 0) AS is_match;

SELECT 1 WHERE REGEXP_LIKE('a', '^a');

SELECT 1 WHERE (REGEXP_LIKE('a', '%pattern%'));