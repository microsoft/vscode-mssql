--setClauseSystemColumn
update t2 set $rowguid = newid()
go
--OPTIMIZE FOR unknown
SELECT * FROM t1 OPTION (OPTIMIZE FOR(@v1 = 20, @v2 = NULL), OPTIMIZE FOR(@v3='zzz'), OPTIMIZE FOR(@v4 unknown))
go
dbcc checkdb WITH ALL_ERRORMSGS, extended_logical_checks

