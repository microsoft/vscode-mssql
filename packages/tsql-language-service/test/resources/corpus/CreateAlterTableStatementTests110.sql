--Filetable tests
create table t1 as filetable
go
create table t1 as filetable on fg1 textimage_on "default" filestream_on "default" with (filetable_directory='foo', filetable_collate_filename=database_default)
go
create table t1 as filetable with(filetable_collate_filename=Latin1_General_bin, filetable_directory=null)
go
alter table t1 enable filetable_namespace
go
alter table t1 disable filetable_namespace
go
alter table t1 set (filetable_directory='foo')
go
CREATE TABLE t AS FileTable WITH (FILETABLE_PRIMARY_KEY_CONSTRAINT_NAME=foo)
GO
CREATE TABLE t AS FileTable WITH (FILETABLE_STREAMID_UNIQUE_CONSTRAINT_NAME=foo)
GO
CREATE TABLE t AS FileTable WITH (FILETABLE_FULLPATH_UNIQUE_CONSTRAINT_NAME=foo)
GO
create table t1 (c1 bigint primary key not null) federated on (c1 = c1)
go
