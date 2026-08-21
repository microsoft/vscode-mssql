-- GENERATE_SERIES
SELECT value
FROM GENERATE_SERIES (1, 5);

SELECT value
FROM GENERATE_SERIES (1, 32, 7);

SELECT value
FROM GENERATE_SERIES (1, 5)
ORDER BY value;

-- DATE_BUCKET
SELECT DATE_BUCKET(WEEK, 10, SYSUTCDATETIME());

DECLARE @date DATETIME2 = '2020-04-30 00:00:00';
SELECT DATE_BUCKET(DAY, 100, @date);

DECLARE @date DATETIME2 = '2020-06-15 21:22:11';
DECLARE @origin DATETIME2 = '2019-01-01 00:00:00';
SELECT DATE_BUCKET(WEEK, 5, @date, @origin) FROM Table1;

-- GREATEST
SELECT GREATEST ( '6.62', 3.1415, N'7' ) AS GreatestVal;

SELECT GREATEST ('Glacier', N'Joshua Tree', 'Mount Rainier') AS GreatestString;

DECLARE @PredictionA DECIMAL(2,1) = 0.7;
DECLARE @PredictionB DECIMAL(3,1) = 0.65;

SELECT VarX, Correlation  
FROM dbo.studies
WHERE Correlation > GREATEST(@PredictionA, @PredictionB);

-- LEAST
SELECT LEAST ( '6.62', 3.1415, N'7' ) AS LeastVal;

SELECT LEAST ('Glacier', N'Joshua Tree', 'Mount Rainier') AS LeastString;

DECLARE @PredictionA DECIMAL(2,1) = 0.7;
DECLARE @PredictionB DECIMAL(3,1) = 0.65;

SELECT VarX, Correlation
FROM dbo.studies
WHERE Correlation < LEAST(@PredictionA, @PredictionB);

-- STRING_SPLIT
SELECT value FROM STRING_SPLIT('Lorem ipsum dolor sit amet.', ' ');

SELECT * FROM STRING_SPLIT('Lorem ipsum dolor sit amet.', ' ', 1);

DECLARE @tags NVARCHAR(400) = 'clothing,road,,touring,bike';

SELECT value
FROM STRING_SPLIT(@tags, ',')
WHERE RTRIM(value) <> '';

SELECT ProductId, Name, Tags
FROM Product
JOIN STRING_SPLIT('1,2,3',',')
    ON value = ProductId;

SELECT *
FROM STRING_SPLIT('Austin,Texas,Seattle,Washington,Denver,Colorado', ',', 1)
WHERE ordinal % 2 = 0;

SELECT * FROM STRING_SPLIT('E-D-C-B-A', '-', 1) ORDER BY ordinal DESC;

-- DATETRUNC
DECLARE @d datetime2 = '2021-12-08 11:30:15.1234567';
SELECT 'Year', DATETRUNC(year, @d);
SELECT 'Quarter', DATETRUNC(quarter, @d);

SELECT DATETRUNC(month, DATEADD(month, 4, TransactionDate))
FROM Sales.CustomerTransactions;