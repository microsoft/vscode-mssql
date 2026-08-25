-- Perf harness XEvents session (design §19 / Phase-2 M8): captures every SQL
-- command caused by perf scenarios, correlated by Application Name
-- ('mssql-perf/<runId>/<repId>/<scenarioId>' — set by the driver's connect
-- step). Ring-buffer target so external and container providers read the same
-- way. Single batch (no GO) so it can run through sqlcmd -Q.
--
-- SQL text is captured into the ring buffer only on the synthetic PerfHarness
-- database; the harness reader only *emits* text columns in diagnostic passes
-- with captureSqlText enabled (§29).

IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'perftest_activity')
    DROP EVENT SESSION [perftest_activity] ON SERVER;

CREATE EVENT SESSION [perftest_activity] ON SERVER
ADD EVENT sqlserver.rpc_completed (
    ACTION (sqlserver.client_app_name, sqlserver.session_id, sqlserver.database_name)
    WHERE sqlserver.client_app_name LIKE N'mssql-perf/%'
),
ADD EVENT sqlserver.sql_batch_completed (
    ACTION (sqlserver.client_app_name, sqlserver.session_id, sqlserver.database_name)
    WHERE sqlserver.client_app_name LIKE N'mssql-perf/%'
),
ADD EVENT sqlserver.sql_statement_completed (
    ACTION (sqlserver.client_app_name, sqlserver.session_id, sqlserver.database_name)
    WHERE sqlserver.client_app_name LIKE N'mssql-perf/%'
),
ADD EVENT sqlserver.module_end (
    ACTION (sqlserver.client_app_name, sqlserver.session_id, sqlserver.database_name)
    WHERE sqlserver.client_app_name LIKE N'mssql-perf/%'
)
ADD TARGET package0.ring_buffer (SET max_memory = 51200) -- KB
WITH (
    MAX_MEMORY = 64 MB,
    EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS,
    MAX_DISPATCH_LATENCY = 3 SECONDS,
    STARTUP_STATE = OFF
);
