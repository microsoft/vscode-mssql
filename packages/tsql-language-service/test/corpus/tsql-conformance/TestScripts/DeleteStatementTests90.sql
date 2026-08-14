--test top row filter
delete top (2.5) percent from t1
delete top (select * from t2) percent from t1
GO
--test output clause
delete t1 output a.*
delete t1 output a.b.c1 as [c2]
delete t1 output a.b.c1 as [c2], c2
delete t1 output 2 + 3 c4

delete t1 output 2 + 3 c4 from t2


delete t1 output c1, c2 into @t1
delete t1 output c1, c2 into @t1(c1)
delete t1 output c1, c2 into dbo.a(c1, c2, c3)

delete t1 output c1, c2 into .dbo.a(c1) from t2


delete t1 output c1, c2 into @t1 output c1 as [C1], 12 * 12 as [144]
delete t1 output c1, c2 into @t1(c1) output C10

delete t1 output c1, c2 into @t1(c1) output C10 from t2



