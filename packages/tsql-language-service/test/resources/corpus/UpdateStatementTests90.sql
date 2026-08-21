-- set clause udt column with property
Update t1 set a.b.c.d.e = 100 - [udt]::t1.f()

--test top row filter
update top (2.5) percent t1 set c1 = 23 + 10
update top (select * from t2) t1 set c1 = 23 + 10
GO
--test output clause
update t1 set c1 = 23 + 10 output a.b.c1 as [c2], c2 from t1 where t1.c1 < 10

update dbo.f1() set @a = a.b = 23 output c1, c2 into @t1(c1)

update t1 set a.b = null output c1, c2 into @t1 output c1 as [C1], 12 * 12 as [144]
GO
-- set clause, method on a udt column
Update t1 set a.b.c.d.func()
Update t1 set a.b.c.d.func(default, 12, 102+123)
