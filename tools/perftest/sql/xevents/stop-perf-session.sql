-- Stop the perf XEvents session (idempotent). The ring buffer is read BEFORE
-- stopping (contents drop when the session stops).
IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = N'perftest_activity')
    ALTER EVENT SESSION [perftest_activity] ON SERVER STATE = STOP;
