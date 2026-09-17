-- Read the perf XEvents ring buffer as JSON (single batch, sqlcmd -Q safe).
-- Deliberately contains NO double-quote characters: the harness passes this
-- whole script as one argv element on Windows, where embedded double quotes
-- get mangled by command-line re-quoting. XQuery attribute values use doubled
-- single quotes instead.
-- Statement/batch text columns are always present here but only PERSISTED by
-- the harness in diagnostic passes with captureSqlText enabled (§29).
SET NOCOUNT ON;
DECLARE @x XML = (
    SELECT CAST(t.target_data AS XML)
    FROM sys.dm_xe_session_targets t
    JOIN sys.dm_xe_sessions s ON s.address = t.event_session_address
    WHERE s.name = N'perftest_activity' AND t.target_name = N'ring_buffer'
);
SELECT
    e.value('@name', 'nvarchar(64)')                                          AS event_name,
    e.value('@timestamp', 'datetime2(7)')                                     AS ts_utc,
    e.value('(action[@name=''client_app_name'']/value)[1]', 'nvarchar(256)')  AS client_app_name,
    e.value('(action[@name=''session_id'']/value)[1]', 'int')                 AS session_id,
    e.value('(action[@name=''database_name'']/value)[1]', 'nvarchar(256)')    AS database_name,
    e.value('(data[@name=''duration'']/value)[1]', 'bigint')                  AS duration_us,
    e.value('(data[@name=''cpu_time'']/value)[1]', 'bigint')                  AS cpu_time_us,
    e.value('(data[@name=''logical_reads'']/value)[1]', 'bigint')             AS logical_reads,
    e.value('(data[@name=''physical_reads'']/value)[1]', 'bigint')            AS physical_reads,
    e.value('(data[@name=''writes'']/value)[1]', 'bigint')                    AS writes,
    e.value('(data[@name=''row_count'']/value)[1]', 'bigint')                 AS row_count,
    e.value('(data[@name=''object_name'']/value)[1]', 'nvarchar(256)')        AS object_name,
    e.value('(data[@name=''statement'']/value)[1]', 'nvarchar(max)')          AS statement_text,
    e.value('(data[@name=''batch_text'']/value)[1]', 'nvarchar(max)')         AS batch_text
FROM @x.nodes('/RingBufferTarget/event') AS q(e)
ORDER BY e.value('@timestamp', 'datetime2(7)')
FOR JSON PATH, INCLUDE_NULL_VALUES;
