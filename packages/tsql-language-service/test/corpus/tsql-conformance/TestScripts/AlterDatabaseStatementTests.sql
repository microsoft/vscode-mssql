-- Add/remove filegroup 
alter database d1 add filegroup fg1
alter database d1 remove filegroup fg1

-- Modify filegroup 
alter database d1 modify filegroup fg1 readonly 
alter database d1 modify filegroup fg1 read_only 
alter database d1 modify filegroup fg1 readwrite 
alter database d1 modify filegroup fg1 read_write 
alter database d1 modify filegroup fg1 default 
alter database d1 modify filegroup fg1 name = fg2

-- add files / log files (Note: file spec is mostly tested in CREATE DATABASE tests)
ALTER DATABASE AdventureWorks ADD FILE 
	(NAME = test1dat3, FILENAME = 'f1'),
	(NAME = test1dat4, FILENAME = 'f2')
	TO FILEGROUP Test1FG

ALTER DATABASE AdventureWorks ADD LOG FILE (FILENAME = 'log', NAME = test1log2)

-- remove/modify files
alter database db1 remove file myfile
alter database db1 modify file (NAME = n1, NEWNAME = n2) 

-- renaming database, changing collation or rebuilding logs
alter database db1 modify name = db2
alter database db1 collate Estonian_CS_AS

-- No syntax collision with DATABASE SCOPED CREDENTIALS
ALTER DATABASE SCOPED COLLATE Estonian_CS_AS;

ALTER DATABASE [SCOPED CREDENTIAL] COLLATE Estonian_CS_AS;
