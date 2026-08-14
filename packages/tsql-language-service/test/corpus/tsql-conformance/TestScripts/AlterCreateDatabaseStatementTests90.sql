alter database d1 modify filegroup fg1 read_only with rollback after 10
alter database d1 modify filegroup fg1 readwrite with rollback after 10 seconds
alter database d1 modify filegroup fg1 read_write with rollback immediate
alter database d1 modify filegroup fg1 read_write with no_wait

ALTER DATABASE AdventureWorks ADD LOG FILE (FILENAME = 'log2', NAME = test1log2), 
	(FILENAME = 'log3', NAME = test1log2) TO FILEGROUP FG

alter database db1 modify file (offline, NAME = n1, NEWNAME = n2) 

alter database db1 rebuild log
alter database db1 rebuild log on (name = 'n1', filename='zzz')
GO

-- attach/service broker options
CREATE DATABASE Archive ON (FILENAME = 'zzz') FOR attach_rebuild_log WITH trustworthy off
CREATE DATABASE Archive ON (FILENAME = 'zzz') FOR attach_force_rebuild_log WITH trustworthy off, db_chaining on
CREATE DATABASE Archive ON (FILENAME = 'zzz') FOR ATTACH WITH ENABLE_BROKER
CREATE DATABASE Archive ON (FILENAME = 'zzz') FOR ATTACH WITH NEW_BROKER
CREATE DATABASE Archive ON (FILENAME = 'zzz') FOR ATTACH WITH ERROR_BROKER_CONVERSATIONS

-- snapshot
CREATE DATABASE sales_snapshot0600 ON ( NAME = N1, FILENAME = 'N1') AS SNAPSHOT OF Sales
