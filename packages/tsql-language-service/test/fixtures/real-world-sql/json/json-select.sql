-- Purpose: Demonstrates selecting arbitrary JSON data with OPENJSON and JSON_VALUE.
-- Tags: sqlserver, json, release-validation, multiple-result-sets

-- Declare a variable with sample JSON data
DECLARE @json NVARCHAR(MAX) = N'
{
    "users": [
        {
            "id": 1,
            "name": "Alice Johnson",
            "email": "alice@example.com",
            "active": true,
            "roles": ["admin", "user"]
        },
        {
            "id": 2,
            "name": "Bob Smith",
            "email": "bob@example.com",
            "active": false,
            "roles": ["user"]
        },
        {
            "id": 3,
            "name": "Charlie Davis",
            "email": "charlie@example.com",
            "active": true,
            "roles": ["user", "moderator"]
        }
    ],
    "metadata": {
        "timestamp": "2025-12-29T10:00:00Z",
        "version": "1.0"
    }
}';

-- Select all users from the JSON array
SELECT
    JSON_VALUE(value, '$.id') AS UserId,
    JSON_VALUE(value, '$.name') AS UserName,
    JSON_VALUE(value, '$.email') AS Email,
    JSON_VALUE(value, '$.active') AS IsActive,
    JSON_QUERY(value, '$.roles') AS Roles
FROM OPENJSON(@json, '$.users');

-- Select users with detailed role information
SELECT
    JSON_VALUE(u.value, '$.id') AS UserId,
    JSON_VALUE(u.value, '$.name') AS UserName,
    r.value AS RoleName
FROM OPENJSON(@json, '$.users') u
CROSS APPLY OPENJSON(JSON_QUERY(u.value, '$.roles')) r;

-- Select metadata
SELECT
    JSON_VALUE(@json, '$.metadata.timestamp') AS Timestamp,
    JSON_VALUE(@json, '$.metadata.version') AS Version;

-- Select active users only
SELECT
    JSON_VALUE(value, '$.id') AS UserId,
    JSON_VALUE(value, '$.name') AS UserName,
    JSON_VALUE(value, '$.email') AS Email
FROM OPENJSON(@json, '$.users')
WHERE JSON_VALUE(value, '$.active') = 'true';
