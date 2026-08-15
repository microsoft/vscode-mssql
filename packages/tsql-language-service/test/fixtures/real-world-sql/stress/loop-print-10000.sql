-- Purpose: Prints 10,000 GUID-tagged messages to test high-volume message output.
-- Tags: sqlserver, messages, output-volume, stress-test

DECLARE @j INT = 0;
DECLARE @message NVARCHAR(100);

WHILE @j < 10000
BEGIN
    SET @message = 'Message ' + CAST(@j AS NVARCHAR(10)) + ': ' + CAST(NEWID() AS NVARCHAR(36));
    PRINT @message;
    SET @j = @j + 1;
END
