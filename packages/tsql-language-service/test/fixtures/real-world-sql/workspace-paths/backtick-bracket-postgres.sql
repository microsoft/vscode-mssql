-- Purpose: PostgreSQL catalog smoke query in a folder whose name contains backticks and brackets.
-- Tags: postgres, path-handling, catalog, smoke-test

SELECT *
FROM information_schema.tables;
