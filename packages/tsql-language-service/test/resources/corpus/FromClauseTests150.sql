-- STRING_SPLIT in FROM clause with ordinal functionality
SELECT * FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ', NULL);

SELECT * FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ', 1);

SELECT value FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ', 0);

SELECT ordinal FROM STRING_SPLIT(N'Lorem ipsum dolor sit amet.', N' ', 1);

SELECT t2.value FROM String_Split('Lorem-ipsum dolor-sit amet.', '-', 0) AS t1 CROSS APPLY String_Split(t1.value, ' ') AS t2;

SELECT t2.ordinal FROM String_Split('Lorem-ipsum dolor-sit amet.', '-', 1) AS t1 CROSS APPLY String_Split(t1.ordinal, ' ') AS t2;

SELECT value FROM (VALUES ('Lorem ipsum'), ('dolor sit amet.')) AS x(col) CROSS APPLY STRING_SPLIT(col, ',', 0);

SELECT ordinal FROM (VALUES ('Lorem ipsum'), ('dolor sit amet.')) AS x(col) CROSS APPLY STRING_SPLIT(col, ',', 1);

SELECT * FROM CHANGETABLE(CHANGES t1, 10, FORCESEEK) AS a;

DELETE t1 FROM CHANGETABLE(CHANGES dbo.t1, @v1, FORCESEEK) AS a(c1);

UPDATE t1
SET c1 = 10
FROM CHANGETABLE(CHANGES d1.dbo.t1, NULL, FORCESEEK) AS a;

SELECT *
FROM CHANGETABLE(VERSION s1.d1.dbo.t1, (c1), (1), FORCESEEK) AS a;

SELECT *
FROM CHANGETABLE(VERSION z..t1, (c1, c2), ('a', 'b'), FORCESEEK) AS a(z1, z2);

SELECT * FROM CHANGETABLE(CHANGES t1, 10) AS a;

DELETE t1 FROM CHANGETABLE(CHANGES dbo.t1, @v1) AS a(c1);

UPDATE t1
SET c1 = 10
FROM CHANGETABLE(CHANGES d1.dbo.t1, NULL) AS a;

SELECT *
FROM CHANGETABLE(VERSION s1.d1.dbo.t1, (c1), (1)) AS a;

SELECT *
FROM CHANGETABLE(VERSION z..t1, (c1, c2), ('a', 'b')) AS a(z1, z2);
