--test top row filter
insert top (2.5) percent @v1 default values
insert top (select * from t2) @v1 default values

GO
--test output clause
insert t1 output a.b.c1 as [c2], c2 default values

Insert table1 with (HOLDLOCK) output c1, c2 into @t1(c1) select * from t1

insert @v2 output c1, c2 into @t1 output c1 as [C1], 12 * 12 as [144] values(10, 20)
