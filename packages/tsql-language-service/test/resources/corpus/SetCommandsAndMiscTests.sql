-- SET COMMANDS
set fips_flagger off, fips_flagger 'entry', fips_flagger 'intermediate'
set fips_flagger 'full', QUERY_GOVERNOR_COST_LIMIT 10
set language us_english
set language 'russian', dateformat ymd
set datefirst @SomeVar
set deadlock_priority low, deadlock_priority @anotherVar
set deadlock_priority normal
set lock_timeout -1
set context_info 0x10000, lock_timeout 1000
set nocount, remote_proc_transactions off
go

-- SET TRANSACTION ISOLATION LEVEL (80-only stuff)
set transaction isolation level READ COMMITTED 
set transaction isolation level READ UNCOMMITTED 
set transaction isolation level REPEATABLE READ 
set transaction isolation level SERIALIZABLE 

-- set textsize statement
set textsize 10
set textsize 0
set textsize -100

-- set identity_insert
set identity_insert d1.dbo.t1 ON
set identity_insert t1 OFF

-- set errlvl
set errlvl 1000