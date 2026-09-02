-- sacaglar: comments inline

-- set clause, variable
Update t1 set @a = 23
-- set clause, variable with column
Update t1 set @a = a.b = 23
Update t1 set @a = a.b = default
Update t1 set @a = a.b = null
-- set clause, column only 
Update t1 set a.b = 23 + 23
Update t1 set a.b = default
Update t1 set a.b = null

-- Dml target tests, without columns(only insert can have them)
Update dbo.f1() set @a = a.b = 23

-- from clause
Update t1 set t1.c1 = 23 + 10 from t1

-- where clause
Update t1 set c1 = 23 + 10 where c1 > 10

-- for clause
Update t1 set c1 = 23 + 10

-- optimizer hints
Update t1 set c1 = 23 + 10 OPTION (ORDER GROUP)

-- all together
Update t1 set t1.c1 = 23 + 10 from t1 where c1 > 10 OPTION (ORDER GROUP)

--update tvf with parameters
update dbo.tvf(-1, 2, DEFAULT) set c1 = 2


