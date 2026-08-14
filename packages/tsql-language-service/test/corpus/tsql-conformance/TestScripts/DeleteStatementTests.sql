-- sacaglar: comments inline

-- Basic usage
Delete t1 
Delete from t1 

-- Dml target tests, without columns(only insert can have them)
-- function call
Delete dbo.f1()
-- table with hints
delete table1 with (nowait, HOLDLOCK)
-- variable
delete @v1
-- open rowset
delete OPENROWSET(something, @var1)
-- with from
delete t1 from t1
-- with where
delete t1 where c1 < 100
-- with optimizer hints
delete t1 OPTION (ORDER GROUP)
-- All together
delete from t1 from t1 where c1 > 130 OPTION (ORDER GROUP)

-- WHERE CURRENT OF where alternative
DELETE FROM authors WHERE CURRENT OF complex_join_cursor
