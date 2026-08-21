set transaction isolation level SNAPSHOT;
GO
ALTER TABLE t1 ALTER COLUMN c1 ADD PERSISTED;
GO
ALTER TABLE t1 ALTER COLUMN c1 DROP PERSISTED;
GO
BACKUP DATABASE db1 READ_WRITE_FILEGROUPS TO d1;
GO
backup database @Var1  to @device1 mirror to mirrorDevice
GO
set statistics xml, time on;
GO
CREATE TRIGGER reminder ON DATABASE FOR INSERT AS RAISERROR (50009, 16, 10);
GO
CREATE TRIGGER reminder ON ALL SERVER FOR INSERT AS RAISERROR (50009, 16, 10);
GO
declare @t1 AS Table (c1 int); -- checking 'AS' keyword
GO
-- improvements to TOP row filter
select top (12 * dbo.func() + 20) c1 from t1;
GO
select top ((select * from t1) except (select c1, c2 from t2)) with ties c1 from t1;
GO
--stats_stream
create statistics [stat] on t1 (c1, c2, c3) with stats_stream = 0x100;
go
update statistics t1 (c1, c2, c3) with stats_stream = 0x100;
update statistics t1 (c1, c2, c3) with stats_stream = 0x100, rowcount = 1, pagecount = 0;