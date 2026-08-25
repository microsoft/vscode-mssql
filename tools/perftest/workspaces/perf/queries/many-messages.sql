-- QO-9a message-flood shape: exactly 10000 PRINT messages, zero result sets.
-- Host message rows observed deterministic at 10003 across reps (10000
-- PRINTs + synthesized Started/Total-time rows + one server info row) —
-- the scenario end marker pins that count.
SET NOCOUNT ON;
DECLARE @i INT = 0;
WHILE @i < 10000
BEGIN
    PRINT N'message ' + CAST(@i AS NVARCHAR(10));
    SET @i = @i + 1;
END;
