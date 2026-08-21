-- Containment
alter database d1 set containment=none
alter database d1 set containment = partial

create database d1 containment = none

create database d1 with nested_triggers = on

create database d1 containment = partial with nested_triggers = on, 
trustworthy on, 
transform_noise_words=off, 
default_language=[french],
default_fulltext_language=1033,
two_digit_year_cutoff=2000

alter database current set transform_noise_words=off,
default_language=1033,
default_fulltext_language=English,
two_digit_year_cutoff=2000,
containment = partial,
trustworthy on,
compatibility_level = 100,
trustworthy off
go
create database d1 on (name= file1, filename='file1.mdf') for attach with restricted_user

--Hadron
alter database d1 set hadr suspend
go
alter database d1 set hadr resume
go
alter database d1 set hadr availability group = g1
go
alter database d1 set hadr off
go
--FileTable
create database d1 with filestream(non_transacted_access=off, directory_name=null)
create database d1 with filestream(directory_name='dir1', non_transacted_access=read_only), trustworthy on
create database d1 with filestream(non_transacted_access=full)
go
create database d1 on (name= file1, filename='file1.mdf') for attach with filestream(directory_name='dir1')
go
alter database d1 set filestream(non_transacted_access=off, directory_name=null)
go

alter database d1 set target_recovery_time = 42 seconds
go
alter database d1 set target_recovery_time = 42 minutes
go

-- Validate that SCOPED and CREDENTIAL don't clash with CONTAINMENT as identifiers.
CREATE DATABASE SCOPED CONTAINMENT = NONE

CREATE DATABASE [SCOPED CREDENTIAL] CONTAINMENT = NONE