-- rebuild
alter table t1 rebuild
alter table t1 rebuild partition = all
alter table t1 rebuild partition = 1 with (MAXDOP = 2)
alter table t1 rebuild with (SORT_IN_TEMPDB = ON, MAXDOP = 2)

-- enable/disable change_tracking
alter table t1 enable change_tracking
alter table t1 disable change_tracking
alter table t1 enable change_tracking with (track_columns_updated = on)
alter table t1 enable change_tracking with (track_columns_updated = off)

-- set
alter table t1 set (lock_escalation = auto, lock_escalation = table)
alter table t1 set (filestream_on = something, lock_escalation = disable)
alter table t1 set (filestream_on = 'something_else')

-- Add/drop sparse on a column
alter table t1 alter column c1 add sparse
alter table t1 alter column c1 drop sparse

-- ALTER COLUMN with SPARSE/FILESTREAM specified
alter table t1 alter column c1 varbinary(max) filestream sparse not null
alter table t1 alter column c1 int sparse
alter table t1 alter column c1 xml column_set for all_sparse_columns null
alter table t1 alter column c1 nvarchar(10) collate latin1_general_bin sparse