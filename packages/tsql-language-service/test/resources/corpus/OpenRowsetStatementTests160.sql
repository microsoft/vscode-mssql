SELECT * FROM OPENROWSET (BULK 'https://sqlondemandstorage.blob.core.windows.net/csv/population/population*.csv', FORMAT = 'CSV', FIRSTROW = 1) WITH ([country_code] VARCHAR(5) COLLATE Latin1_General_BIN2 1, [population] bigint 4) AS [r1];

SELECT * FROM OPENROWSET(BULK 'https://pandemicdatalake.blob.core.windows.net/public/curated/covid-19/ecdc_cases/latest/ecdc_cases.csv', FORMAT = 'CSV', PARSER_VERSION = '2.0', HEADER_ROW = TRUE) as [r2];

SELECT * FROM OPENROWSET(BULK 'https://pandemicdatalake.blob.core.windows.net/public/curated/covid-19/ecdc_cases/latest/ecdc_cases.csv', FORMAT = 'CSV', PARSER_VERSION = '2.0') as [r3];

SELECT TOP 1 * FROM OPENROWSET(BULK 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=20*/*.parquet', FORMAT = 'PARQUET') AS [r4];

SELECT * FROM OPENROWSET(BULK 'https://sqlondemandstorage.blob.core.windows.net/csv/population/population*.csv', FORMAT = 'CSV', FIRSTROW = 1) WITH([country_code] VARCHAR(5) COLLATE Latin1_General_BIN2 1, [population] bigint 4) AS [r6];

SELECT TOP 1 * FROM OPENROWSET( BULK 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=20*/*.parquet', FORMAT = 'PARQUET')WITH([stateName] VARCHAR(50), [stateName_explicit_path] VARCHAR(50) '$.stateName', [COUNTYNAME] VARCHAR (50), [countyName_explicit_path] VARCHAR(50) '$.COUNTYNAME', [population] bigint 'strict $.population') AS [r7];

SELECT TOP 10 * FROM OPENROWSET( BULK ( 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=2000/*.parquet' ), FORMAT = 'PARQUET') AS [r8];

SELECT TOP 10 * FROM OPENROWSET( BULK ( 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=2000/*.parquet', 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=2010/*.parquet', ), FORMAT = 'PARQUET') AS [r9];

SELECT TOP 10 * FROM OPENROWSET( BULK ( 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=2000/*.parquet', 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=2010/*.parquet', 'https://azureopendatastorage.blob.core.windows.net/censusdatacontainer/release/us_population_county/year=2008/*.parquet', ), FORMAT = 'PARQUET') AS [r9];

GO