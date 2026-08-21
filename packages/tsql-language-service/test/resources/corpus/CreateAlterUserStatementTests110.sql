--Contained users
create user contained_user with password = 'foo', default_language = 1033, default_schema=dbo, sid = 0xdeadbeef

alter user contained_user with password = 'foo', default_language = none, default_schema=dbo

alter user contained_user with password = 'foo' old_password='old'
go
--Audit enhancements - null default_schema
create user [domain\user] with default_schema=null
alter user user1 with default_schema=null