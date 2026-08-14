--test udt expressions
select t::a, .t2::f(), dbo.[type 1]::[Property], [funcType]::f(default, 1, @3 + t::Pi)
GO
--test new column and function call with identifiers more than 4
select a.b.c.f.e.g.h, k.l.m.n.o.func()
GO
--test properties and function calls on primary expressions
select @a.[f1](c1, c2), a.b.c.d.f().g.h.k(1, 2, default).l
GO
select (a.b()).A, dbo.t1.c1.Prop.Func(default, @a.A), t::a.f().G, [dbo].[type]::func().func2(@a.f())
GO
-- partition function tests
select [db].$PARTition.f1(@a), db.$partition.[f2](1, 2 + 12), $partition.f1(12+ 12), $partition.[part func](a.b::f())
GO
-- with over clause
select t1.count(all c1) over (partition by c1), count (all c1) over (partition by c1, c2 + 10) from t1
select time() over (), time(1) over (partition by c1, c2 + 3 order by c1), sum(*) over( partition by c1), [dbo].f1() over (partition by c1), .f2(default, 'def') over (partition by c1, c2)
SELECT ROW_NUMBER() OVER (ORDER BY column_1 ASC) AS column_1 FROM Table1;
GO
