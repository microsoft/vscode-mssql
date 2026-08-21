-- Azure options
create database d1 (maxsize=1gb)
create database d1 (maxsize=1gb, edition='business')
create database d1 (edition='web', maxsize=5 gb)
create database d1 as copy of server1.d2
create database d1 as copy of d2
go

alter database d1 modify (edition = 'web')
alter database d1 modify (maxsize = 5 gb, edition='business')
go
