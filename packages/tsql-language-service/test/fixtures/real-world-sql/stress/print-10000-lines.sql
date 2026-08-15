-- Purpose: Prints 10,000 lines, then emits 100 SELECT result sets for output-volume testing.
-- Tags: sqlserver, messages, output-volume, result-sets, stress-test

DECLARE @counter INT = 1;

WHILE @counter <= 10000
BEGIN
    PRINT 'Line ' + CAST(@counter AS VARCHAR(10));
    SET @counter = @counter + 1;
END

SET @counter = 1;

WHILE @counter <= 100
BEGIN
    PRINT 'Line ' + CAST(@counter AS VARCHAR(10));
    SELECT @counter;
    SET @counter = @counter + 1;
END

PRINT 'Completed printing 10,000 lines and executing 100 SELECT statements';
