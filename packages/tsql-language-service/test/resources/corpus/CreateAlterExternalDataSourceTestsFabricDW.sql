CREATE EXTERNAL DATA SOURCE MyDataSource
    WITH (
    LOCATION = 'sqlserver://10.10.10.10:1433'
    );

CREATE EXTERNAL DATA SOURCE BlobSource
    WITH (
    LOCATION = 'wasbs://container@account.blob.core.windows.net'
    );

ALTER EXTERNAL DATA SOURCE MyDataSource SET LOCATION = 'sqlserver://192.168.1.100:1433';