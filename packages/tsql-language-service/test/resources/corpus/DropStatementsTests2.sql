-- olegr: DROP statements with keywords following are wrapped into procs to enable
--        error recovery in 80 case, which allows to test more error conditions with single input

-- drop schema
CREATE PROCEDURE P1 AS
BEGIN
	drop schema s1
	drop schema s1 RESTRICT
	drop schema i1.i2 CASCADE
END
GO
-- new drop index syntax
CREATE PROCEDURE P1 AS
BEGIN
	drop index i1 on dbo.t1
	drop index i1 on t1 with (maxdop = 2), authors.au_id_ind
	drop index i1 on t1 with (online = on, move to fg1), i2 on t2 with (online = off, move to fg1 (c1))
END
go
-- drops for Sql 2005 objects
CREATE PROCEDURE P1 AS
BEGIN
	Drop Trigger t1, t2 on all server
	Drop trigger t1 on database
END
go
CREATE PROCEDURE P1 AS
BEGIN
	drop user u1
END
go
drop partition function f1
drop partition scheme s1
go
drop synonym s1, dbo.s2

go

drop application role a1
go

drop fulltext catalog c1

go

drop role r1
go

drop type t1
drop type db1.dbo.t1

go
drop aggregate dbo.[b]
drop aggregate a, dbo.[b], c
go

drop assembly a
drop assembly a with no dependents
go

drop certificate c1
go

drop credential c1
go

drop master key
go

drop xml schema collection [dbo].b
drop xml schema collection a
go

drop contract c1
go

drop endpoint e1
go

drop message type mt1
go

drop queue q1
drop queue db1.dbo.q1
drop queue .dbo.q1
go

drop remote service binding rsb1
go

drop route r1
go

drop service s1
go

drop event notification n1, n2 on server
drop event notification n1 on database
drop event notification n1 on queue q1
drop event notification n1 on queue dbo.q1