-- LTRIM
SELECT LTRIM('     Five spaces are at the beginning of this string.');

DECLARE @string_to_trim VARCHAR(60);
SET @string_to_trim = '     Five spaces are at the beginning of this string.';
SELECT
    @string_to_trim AS 'Original string',
    LTRIM(@string_to_trim) AS 'Without spaces';

SELECT LTRIM('123abc.' , '123.');

-- RTRIM
SELECT RTRIM('Removes trailing spaces.   ');

DECLARE @string_to_trim VARCHAR(60);
SET @string_to_trim = 'Four spaces are after the period in this sentence.    ';
SELECT @string_to_trim + ' Next string.';
SELECT RTRIM(@string_to_trim) + ' Next string.';

SELECT RTRIM('.123abc.' , 'abc.');

---- TRIM
SELECT TRIM('     test    ') AS Result;

SELECT TRIM( '.,! ' FROM '     #     test    .') AS Result;

SELECT TRIM(LEADING '.,! ' FROM '     .#     test    .') AS Result;

SELECT TRIM(TRAILING '.,! ' FROM '     .#     test    .') AS Result;

SELECT TRIM(BOTH '123' FROM '123abc123') AS Result;

DECLARE @string_to_trim AS VARCHAR (60);
SET @string_to_trim = 'Four X are after the period in this sentence.XXXX';
SELECT 
    @string_to_trim + ' Next string.' AS 'Original string',
    TRIM(TRAILING 'X' FROM @string_to_trim) + ' Next string.' AS 'Without X';

SELECT TRIM(LTRIM(' Test') COLLATE Latin1_General_100_BIN2 FROM N'TestString');

SELECT TRIM('Test' + 'S'  FROM N'TestString');