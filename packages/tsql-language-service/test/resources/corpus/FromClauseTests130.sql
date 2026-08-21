-- OPENJSON in FROM clause
SELECT * FROM OPENJSON(N'{"a":{"b":[1,2,3]}}');

SELECT [key],[value],[type] FROM OPENJSON(N'{"a":{"b":[1,2,3]}}', '$.a');

SELECT c1 FROM OPENJSON(N'{"a":{"b":[1,2,3]}}') WITH (c1 int '$.a.b[2]');

SELECT * FROM OPENJSON(N'{"a":"12", "b":{"c":"string"}}', N'$') WITH (a int, c nvarchar(max) collate Latin1_General_Bin2 N'$.b.c');

SELECT * FROM OPENJSON(N'{"a":"12", "b":{"c":"string"}}', N'$') WITH (a int, f nvarchar(max) collate Latin1_General_Bin2 N'$.b' as json);

SELECT * FROM OPENJSON(N'[{{"a":[10,11,12]}}]') WITH (a nvarchar(max) as json);

SELECT * FROM OPENJSON(@var);

SELECT * FROM OPENJSON(@var, N'$') WITH (a int, b varchar(400), c nvarchar(max) collate Latin1_General_Bin2 N'$.b.c');

SELECT * FROM Orders CROSS APPLY OPENJSON (Orders.Data, N'$.orderLineItems') WITH (ProductId VARCHAR (200) N'$.productId')

SELECT * FROM OPENJSON(col, N'$') WITH (a int, b varchar(400), c nvarchar(max) collate Latin1_General_Bin2 N'$.b.c');

SELECT * FROM OPENJSON([col], N'$') WITH (a int, b varchar(400), c nvarchar(max) collate Latin1_General_Bin2 N'$.b.c');

SELECT * FROM OPENJSON(col1.col2, N'$') WITH (a int, b varchar(400), c nvarchar(max) collate Latin1_General_Bin2 N'$.b.c');

SELECT * FROM OPENJSON(func(col), N'$') WITH (a int, b varchar(400), c nvarchar(max) collate Latin1_General_Bin2 N'$.b.c');

SELECT * FROM OPENJSON(col1 + col2, N'$') WITH (a int, b varchar(400), c nvarchar(max) collate Latin1_General_Bin2 N'$.b.c');

-- STRING_SPLIT in FROM clause
SELECT * FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ');

SELECT * FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ', 1);

SELECT value FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ');

SELECT ordinal FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ', 1);

SELECT * FROM string_split(NULL, N',');

SELECT t2.value FROM String_Split('Lorem-ipsum dolor-sit amet.', '-') AS t1 CROSS APPLY String_Split(t1.value, ' ') AS t2;

SELECT t2.ordinal FROM String_Split('Lorem-ipsum dolor-sit amet.', '-', 1) AS t1 CROSS APPLY String_Split(t1.ordinal, ' ') AS t2;

SELECT value FROM (VALUES ('Lorem ipsum'), ('dolor sit amet.')) AS x(col) CROSS APPLY STRING_SPLIT(col, ',');

SELECT ordinal FROM (VALUES ('Lorem ipsum'), ('dolor sit amet.')) AS x(col) CROSS APPLY STRING_SPLIT(col, ',', 1);

SELECT * FROM [STRING_SPLIT](@var, @sep);

SELECT * FROM "STRING_SPLIT"(@var, @sep);
