-- Insert with CTEs
with DirReps(c1, c2) as (select c1 from t1) Insert @v1 default values;

GO

-- Select with CTEs
with DirReps(c1, c2) as (select c1 from t1) select c1 from t1;
with DirReps(c1, c2) as (select c1 from t1), [cte2] as (select * from t2) select c1 from t1;
with xmlnamespaces('u' as n1) select c1 from t1;
with xmlnamespaces(N'u' as n1, 'u2' as n2) select c1 from t1;
with xmlnamespaces(default 'u') select c1 from t1;
with xmlnamespaces(N'u' as n1, 'u2' as n2, default 'u'), DirReps(c1, c2) as (select c1 from t1), [cte2] as (select * from t2) select c1 from t1;
GO

-- Testing CTEs, these are tested in more depth at SelectStatement tests
with DirReps(c1, c2) as (select c1 from t1) Update t1 set c1 = 23 + 10;
GO

with DirReps(c1, c2) as (select c1 from t1) delete t1 from t1

--CTE in Cursor
declare c cursor for with DirReps(c1, c2) as (select c1, 1 from t1) select c1 from t1;
