CREATE EVENT SESSION [test_not_like] ON SERVER 
ADD EVENT sqlserver.sql_statement_completed
(
    ACTION(sqlserver.sql_text)
    WHERE ([sqlserver].[like_i_sql_unicode_string]([sqlserver].[sql_text], N'%foo%') 
    AND [sqlserver].[client_app_name] NOT LIKE N'SQLAgent%')
)
ADD TARGET package0.event_file
(
    SET filename=N'test_not_like.xel'
)
WITH 
(
    MAX_MEMORY=4096 KB,
    EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,
    MAX_DISPATCH_LATENCY=30 SECONDS,
    MAX_EVENT_SIZE=0 KB,
    MEMORY_PARTITION_MODE=NONE,
    TRACK_CAUSALITY=OFF,
    STARTUP_STATE=OFF
)
GO

    