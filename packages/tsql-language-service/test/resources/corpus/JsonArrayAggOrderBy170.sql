-- Test JSON_ARRAYAGG with ORDER BY clause

-- Basic ORDER BY
SELECT JSON_ARRAYAGG(value ORDER BY value) FROM mytable;

-- ORDER BY with ASC
SELECT JSON_ARRAYAGG(name ORDER BY name ASC) FROM users;

-- ORDER BY with DESC
SELECT JSON_ARRAYAGG(score ORDER BY score DESC) FROM scores;

-- ORDER BY with multiple columns
SELECT JSON_ARRAYAGG(data ORDER BY priority DESC, created_at ASC) FROM records;

-- ORDER BY with NULL CLAUSE
SELECT JSON_ARRAYAGG(value ORDER BY value NULL ON NULL) FROM data;

-- Real-world example with GROUP BY and system tables
SELECT TOP(5) c.object_id, JSON_ARRAYAGG(c.name ORDER BY c.column_id) AS column_list
FROM sys.columns AS c
GROUP BY c.object_id;

-- JSON_ARRAYAGG with OVER clause (PARTITION BY)
SELECT JSON_ARRAYAGG(name) OVER (PARTITION BY dept) FROM employees;

-- JSON_ARRAYAGG with ABSENT ON NULL and OVER clause
SELECT JSON_ARRAYAGG(name ABSENT ON NULL) OVER (PARTITION BY dept) FROM employees;

-- JSON_ARRAYAGG with NULL ON NULL and OVER clause
SELECT JSON_ARRAYAGG(name NULL ON NULL) OVER (PARTITION BY dept) FROM employees;

-- JSON_ARRAYAGG with ORDER BY, NULL ON NULL, RETURNING JSON, and OVER clause
SELECT JSON_ARRAYAGG(name ORDER BY name NULL ON NULL RETURNING JSON) OVER (PARTITION BY dept) FROM employees;