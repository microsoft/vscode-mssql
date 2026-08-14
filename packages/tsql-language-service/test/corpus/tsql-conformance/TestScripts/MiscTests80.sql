CREATE DATABASE db1 ON (NAME = Sales_dat,FILENAME = 'zzz') FOR LOAD
go
SELECT * from: sysobjects;
go
select * FROM t (TABLOCK, INDEX(myindex));
go
CREATE STATISTICS sts ON uarule (rule_id) WITH ROWS;
go
UPDATE STATISTICS t WITH ROWS;
go
DISK INIT NAME = 'DEVICE1', PHYSNAME = 'c:\sql80\data\device1.dat', VDEVNO = 1, SIZE = 6144;
go
disk resize size = 1057,
	name = "tempdev", 
	size = @v,
	name="templog"
go
DISK INIT NAME = 'DEVICE1', PHYSNAME = 'c:\sql80\data\device1.dat', vstart=1, VDEVNO = 1, SIZE = 6144, NAME = 'DEVICE1'
go	 
select c1 from t1 (holdlock, readpast, index = 0)
go