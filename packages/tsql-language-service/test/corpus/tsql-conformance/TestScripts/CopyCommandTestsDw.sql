COPY INTO FactOnlineSales FROM 'https://contosoretaildw.blob.core.windows.net/contosoretaildw-tables/FactOnlineSales/' 
WITH ( 
   FIELDTERMINATOR = '|', 
   DATEFORMAT = 'ymd', 
   ROWTERMINATOR = '0x0A' 
) 

COPY INTO dbo.[FactOnlineSalesv1] FROM 'https://unsecureaccount.blob.core.windows.net/customerdatasets/linitem.csv'

COPY INTO test_1 
FROM 'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_1.txt' 
WITH ( 
    FILE_TYPE = 'CSV', 
    CREDENTIAL = (IDENTITY= 'Shared Access Signature', SECRET='<Your_SAS_Token>'), 
    FIELDQUOTE = '"', 
    FIELDTERMINATOR =';', 
    ROWTERMINATOR ='0X0A', 
    ENCODING = 'UTF8', 
    DATEFORMAT = 'ymd', 
    MAXERRORS = 10, 
    ERRORFILE = '/sastest/errorsfolder/',
    FIRSTROW = 2
    ) 

COPY INTO test_2
FROM 'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_2.txt' 
WITH ( 
    FILE_TYPE = 'CSV', 
    IDENTITY_INSERT = 'ON',
    CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET ='<Your_SAS_Token>'), 
    FIELDQUOTE = '"', 
    FIRSTROW = 2,
    FIELDTERMINATOR =';', 
    ROWTERMINATOR='0X0A', 
    ENCODING = 'UTF8', 
    DATEFORMAT = 'ymd', 
    MAXERRORS = 10, 
    ERRORFILE = '/sastest/errorsfolder/'
    ) 

COPY INTO test_3(Col_one default 'stringdefault' 1, Col_two default 1 3)
FROM 'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_3.txt' 
WITH ( 
    FILE_TYPE = 'CSV', 
    IDENTITY_INSERT = 'OFF',
    CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET ='<Your_SAS_Token>'), 
    FIELDQUOTE = '"', 
    FIRSTROW = 2,
    FIELDTERMINATOR = ';', 
    ROWTERMINATOR = '0X0A', 
    ENCODING = 'UTF8', 
    DATEFORMAT = 'ymd', 
    MAXERRORS = 10, 
    ERRORFILE = '/sastest/errorsfolder/'
    )

COPY INTO test_4
FROM 'https://polybasewasb.blob.core.windows.net/customerdatasets/parquet/test.parquet' 
WITH ( 
     FILE_TYPE = 'PARQUET',
     CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET ='<Your_SAS_Token>')
     )

COPY INTO test_5
FROM 'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_5.txt' 
WITH ( 
    FILE_TYPE = 'PARQUET', 
    FILE_FORMAT = fileformat, 
    IDENTITY_INSERT = 'ON',
    CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET ='<Your_SAS_Token>'), 
    FIELDQUOTE = '"', 
    FIRSTROW = 2,
    FIELDTERMINATOR = ';', 
    ROWTERMINATOR = '0X0A', 
    ENCODING = 'UTF8', 
    DATEFORMAT = 'ymd', 
    MAXERRORS = 10, 
    COMPRESSION = 'GZIP',
    ERRORFILE = '/sastest/errorsfolder/'
    ) 

COPY INTO test_6
FROM 'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_6.txt' 
WITH ( 
    FILE_TYPE = 'ORC', 
    IDENTITY_INSERT = 'ON',
    CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET ='<Your_SAS_Token>'), 
    FIELDQUOTE = '"', 
    FIRSTROW = 2,
    FIELDTERMINATOR = ';', 
    ROWTERMINATOR = '0X0A', 
    ENCODING = 'UTF8', 
    DATEFORMAT = 'ymd', 
    MAXERRORS = 10, 
    ERRORFILE = '/sastest/errorsfolder/',
    COMPRESSION = 'DefaultCodec',
    ERRORFILE_CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET ='<Your_SAS_Token>')
    )

COPY INTO FactOnlineSales
FROM 'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_3.txt',
'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_4.txt'
WITH ( 
    FILE_TYPE = 'CSV', 
    IDENTITY_INSERT = 'ON',
    CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET ='<Your_SAS_Token>'), 
    FIELDQUOTE = '"', 
    FIRSTROW = 2,
    FIELDTERMINATOR = ';', 
    ROWTERMINATOR = '0X0A', 
    ENCODING = 'UTF8', 
    DATEFORMAT = 'dmy', 
    MAXERRORS = 10, 
    COMPRESSION = 'Snappy',
    ERRORFILE = '/sastest/errorsfolder/'
    ) 

COPY INTO FactOnlineSales
FROM 'https://loadingtest.blob.core.windows.net/customerdatasets/sastest/test_3.txt'
WITH ( 
    FILE_TYPE = 'CSV', 
    IDENTITY_INSERT = 'ON',
    CREDENTIAL = (IDENTITY = 'MANAGED IDENTITY'),
    FIELDQUOTE = '"', 
    FIRSTROW = 2,
    FIELDTERMINATOR = ';', 
    ROWTERMINATOR = '0X0A', 
    ENCODING = 'UTF8', 
    DATEFORMAT = 'dmy', 
    MAXERRORS = 10, 
    COMPRESSION = 'GZIP',
    ERRORFILE = '/sastest/errorsfolder/'
    )