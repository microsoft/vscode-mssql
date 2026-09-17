-- Start the perf XEvents session (idempotent).
IF EXISTS (SELECT 1 FROM sys.server_event_sessions s
           WHERE s.name = N'perftest_activity'
             AND NOT EXISTS (SELECT 1 FROM sys.dm_xe_sessions r WHERE r.name = s.name))
    ALTER EVENT SESSION [perftest_activity] ON SERVER STATE = START;
