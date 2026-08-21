-- Select statement basics

SELECT * FROM schema1.table2

GO

SELECT 1, *, 2 FROM table1

GO

SELECT * FROM table1

GO

SELECT *, * FROM table1 as table2, table3 table4, table5

GO

-- Testing all
select all c1 [column 1], c2 as [column 2] from t1;

-- Testing distinct
select distinct c1 [column 1], c2 as [column 2] from t1;

GO

-- Testing TopRowFilter
select top 10000 c1 from t1;
select top 20.12 percent with ties c1 from t1;
select all top 80 percent with ties c1 from t1;

GO

-- Test Into
select c1 into t2 from t1;
select all c1 into myDb..t2 from t1;
(select c1 into t2 from t1);
((select c1 into t2 from t1));
select c1 into t2 from t1 union select c1 from t2;
(select c1 into t2 from t1) union select c1 from t2;
GO

-- Test Where

SELECT Tab1.name, Tab2.id FROM Tab1, Tab2 WHERE Tab1.id = 1

select * from table1 as t1 where t1.c1 > 100; 

GO

-- Test Group By
-- basic
Select * from t1 group by c1;
-- testing all
Select * from t1 group by all c1;
-- testing all with multiple columns
Select * from t1 group by all c1, c2, c3;
-- testing multiple expressions
select * from t1 group by c1, c2, c3
-- testing with
select * from t1 group by c1, c2 with rollup
select * from t1 group by c1, c2 with cube

GO

-- Test having
select * from t1 having t1.c1 > 100;

-- test all clauses together
select t1.c1, t2.c1 as [t2.c1] from t1, t10 as t2 where t2.c1 < 100 group by all t1.c1 having t1.c1 + 10 > 1000;

-- test order by
-- asc, desc, null, identifier
select * from t1 order by c1, c2 asc, c3 desc
select * from t1 where c1 > 1000 order by c1, c2 asc, c3 desc
-- literal
select c1,c2 from t1 cross join t2 union select * from t2 order by 1 asc

GO



-- For Bug 742378 - Error parsing GUID syntax {guid'...'}
-- Ascii Guid

select {guid'34501789-D036-DD11-8F91-F6311CA728A5'} as myguid
GO

-- Unicode Guid

select {guid N'34501789-D036-DD11-8F91-F6311CA728A5'} as myguid