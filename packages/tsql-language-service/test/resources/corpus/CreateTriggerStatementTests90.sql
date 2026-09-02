-- Dml Trigger 2005
CREATE TRIGGER reminder on t1 with execute as caller for insert as external name a.b.c
GO
CREATE TRIGGER reminder on t1 with encryption, execute as self after update, delete, insert not for replication as external name a.b.c;;
GO
CREATE TRIGGER reminder on t1 with execute as owner, encryption instead of delete, insert as print 'hi'
GO
CREATE TRIGGER reminder on t1 with execute as 'dbo' for delete not for replication as print 'hi'
GO
CREATE TRIGGER reminder on t1 with encryption instead of delete as print 'hi'
GO

-- Ddl Trigger 2005
CREATE TRIGGER reminder on all server with execute as caller for deny_database as external name a.b.c
GO
CREATE TRIGGER reminder on database with encryption, execute as self after drop_function, create_function as external name a.b.c;;
GO
CREATE TRIGGER reminder on database with execute as 'dbo' for alter_assembly, drop_function, create_function as print 'hi'
GO