-- ISJSON
SELECT id, json_col
FROM tab1
WHERE ISJSON(json_col) = 1

SELECT id, json_col
FROM tab1
WHERE ISJSON(json_col, SCALAR) = 1

SELECT ISJSON('true', VALUE)

-- JSON_PATH_EXISTS
DECLARE @jsonInfo NVARCHAR(MAX);
SET @jsonInfo=N'{"info":{"address":[{"town":"Paris"},{"town":"London"}]}}';
SELECT JSON_PATH_EXISTS(@jsonInfo,'$.info.address');

SELECT JSON_OBJECT('name':'value');

SELECT JSON_OBJECT('name':'value', 'type':1 NULL ON NULL);

SELECT JSON_OBJECT(NULL ON NULL);

SELECT JSON_OBJECT('name':'value', 'type':NULL ABSENT ON NULL);

SELECT JSON_OBJECT('name':'value', 'type':JSON_OBJECT('type_id':1, 'name':'a'));

SELECT JSON_OBJECT();

SELECT JSON_OBJECT('name':'value', 'type':1);

SELECT JSON_OBJECT('name':'value', 'type':JSON_ARRAY(1, 2));

DECLARE @id_key AS NVARCHAR (10) = N'id', @id_value AS NVARCHAR (64) = NEWID();

SELECT JSON_OBJECT('user_name':USER_NAME(), @id_key:@id_value, 'sid':(SELECT @@SPID));

SELECT s.session_id,
       JSON_OBJECT(security_id:s.security_id, 'login':s.login_name, 'status':s.status) AS info
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1;

SELECT JSON_OBJECT('name':'b' RETURNING JSON);

SELECT JSON_OBJECT('name':'b' NULL ON NULL RETURNING JSON);

SELECT JSON_OBJECT('name':'b' ABSENT ON NULL RETURNING JSON);

SELECT JSON_ARRAY('a', JSON_OBJECT('name':'value', 'type':1 NULL ON NULL) NULL ON NULL);

SELECT JSON_ARRAY();

SELECT JSON_ARRAY('name');

SELECT JSON_ARRAY('a', 1, 'b', 2);

SELECT JSON_ARRAY('a', 1, NULL, 2 NULL ON NULL);

SELECT JSON_ARRAY('a', 1, NULL, 2 ABSENT ON NULL);

SELECT JSON_ARRAY(NULL ON NULL);

SELECT JSON_ARRAY(ABSENT ON NULL);

DECLARE @id_value AS NVARCHAR (64) = NEWID();

SELECT JSON_ARRAY(1, @id_value, (SELECT @@SPID));

SELECT s.session_id,
       JSON_ARRAY(s.host_name, s.program_name, s.client_interface_name)
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1;

SELECT JSON_ARRAY('a', 1, NULL, 2 RETURNING JSON);

SELECT JSON_ARRAY('a', 1, NULL, 2 NULL ON NULL RETURNING JSON);

SELECT JSON_ARRAY('a', 1, NULL, 2 ABSENT ON NULL RETURNING JSON);

SELECT JSON_OBJECTAGG('name':'value');

SELECT JSON_OBJECTAGG('name':'value' NULL ON NULL);

SELECT JSON_OBJECTAGG(NULL ON NULL);

SELECT JSON_OBJECTAGG('name':NULL ABSENT ON NULL);

SELECT JSON_OBJECTAGG('name':JSON_OBJECT('type_id':1, 'name':'a'));

SELECT JSON_OBJECTAGG();

SELECT JSON_OBJECTAGG('name':1);

SELECT JSON_OBJECTAGG('name':JSON_ARRAY(1, 2));
SELECT JSON_OBJECTAGG('name':'b' NULL ON NULL RETURNING JSON);

SELECT JSON_OBJECTAGG('name':'b' ABSENT ON NULL RETURNING JSON);

SELECT JSON_OBJECTAGG('name':'b' RETURNING JSON);

SELECT JSON_ARRAYAGG('name');

SELECT JSON_ARRAYAGG('a');
SELECT JSON_OBJECTAGG( c1:c2 )
SELECT JSON_OBJECTAGG( c1:'c2' )

SELECT JSON_ARRAYAGG('a' NULL ON NULL);

SELECT JSON_ARRAYAGG('a' NULL ON NULL RETURNING JSON);

SELECT s.session_id,
       JSON_ARRAYAGG(s.host_name)
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1;

SELECT s.session_id,
       JSON_ARRAYAGG(s.host_name NULL ON NULL)
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1;

SELECT s.session_id,
       JSON_ARRAYAGG(s.host_name NULL ON NULL RETURNING JSON)
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1;

GO
CREATE VIEW dbo.jsonfunctest AS
                    SELECT JSON_OBJECTAGG( c1:c2 ) as jsoncontents
                    FROM (
                    VALUES('key1', 'c'), ('key2', 'b'), ('key3','a')
                    ) AS t(c1, c2);

GO

SELECT JSON_QUERY('{ "a": 1 }');
SELECT JSON_QUERY('{ "a": 1 }', '$.a');
SELECT JSON_QUERY('{ "a": [1,2,3] }', '$.a' WITH ARRAY WRAPPER);

GO
CREATE VIEW dbo.jsonfunctest AS
                    SELECT JSON_OBJECTAGG( c1:c2 ) as jsoncontents
                    FROM (
                    VALUES('key1', 'c'), ('key2', 'b'), ('key3','a')
                    ) AS t(c1, c2);

GO
SELECT TOP(5) c.object_id, JSON_OBJECTAGG(c.name:c.column_id) AS columns
  FROM sys.columns AS c
 GROUP BY c.object_id;

SELECT JSON_VALUE('a', '$');
SELECT JSON_VALUE('c', '$' RETURNING INT);
SELECT JSON_VALUE('c', '$' RETURNING SMALLINT);
SELECT JSON_VALUE('c', '$' RETURNING BIGINT);
SELECT JSON_VALUE('c', '$' RETURNING TINYINT);
SELECT JSON_VALUE('c', '$' RETURNING NUMERIC);
SELECT JSON_VALUE('c', '$' RETURNING FLOAT);
SELECT JSON_VALUE('c', '$' RETURNING REAL);
SELECT JSON_VALUE('c', '$' RETURNING DECIMAL);
SELECT JSON_VALUE('c', '$' RETURNING CHAR);
SELECT JSON_VALUE('c', '$' RETURNING NVARCHAR(50));
SELECT JSON_VALUE('c', '$' RETURNING NCHAR);
SELECT JSON_VALUE('c', '$' RETURNING DATE);
SELECT JSON_VALUE('c', '$' RETURNING DATETIME2);
SELECT JSON_VALUE('c', '$' RETURNING TIME);
SELECT JSON_VALUE('c', '$' RETURNING BIT);

-- Json_Contains
SELECT id,
       json_col
FROM tab1
WHERE JSON_CONTAINS(json_col, 'abc', '$.a') = 1;

-- Json_Contains as LIKE
SELECT id,
       json_col
FROM tab1
WHERE JSON_CONTAINS(json_col, 'abc%', '$.a', 1) = 1;

-- Json_Modify
SELECT JSON_MODIFY(json_col, '$.a', 30)
FROM tab1;

-- JSON_OBJECTAGG with qualified column names (from GitHub issue #175)
SELECT JSON_OBJECTAGG( t.c1 : t.c2 )
FROM (
    VALUES('key1', 'c'), ('key2', 'b'), ('key3','a')
) AS t(c1, c2);
