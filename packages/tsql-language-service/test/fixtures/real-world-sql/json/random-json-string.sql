-- Purpose: Returns a single random JSON-like string value for result-grid display testing.
-- Tags: sqlserver, json, result-grid, smoke-test

SELECT TOP 1
    CONCAT(
        '{ "id": ', ABS(CHECKSUM(NEWID())) % 1000,
        ', "value": "', NEWID(),
        '", "flag": ', ABS(CHECKSUM(NEWID())) % 2,
        ' }'
    ) AS RandomJson;
