DECLARE @text AS VARCHAR (100) = 'abcabc';
DECLARE @pattern AS VARCHAR (10) = 'a+';
DECLARE @flags AS CHAR (1) = 'i';

SELECT *
FROM REGEXP_MATCHES ('aaa', 'a');
SELECT *
FROM REGEXP_MATCHES ('hello', 'he(l+)o', 'i');
SELECT *
FROM REGEXP_MATCHES (@text, 'a');
SELECT *
FROM REGEXP_MATCHES (@text, @pattern, @flags);

SELECT *
FROM REGEXP_SPLIT_TO_TABLE ('aaa', 'a');
SELECT *
FROM REGEXP_SPLIT_TO_TABLE ('hello', 'he(l+)o', 'i');
SELECT *
FROM REGEXP_SPLIT_TO_TABLE (@text, 'a');
SELECT *
FROM REGEXP_SPLIT_TO_TABLE (@text, @pattern, @flags);