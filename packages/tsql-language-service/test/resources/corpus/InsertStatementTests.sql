-- sacaglar: comments inline

-- Basic usage
Insert t1 default values
Insert into t1 values(10, 20)
Insert over t1 default values
Insert .db..t1 default values

-- Optional column list
Insert ..t1 (c1, a.b.c.d, a...d, .c.d) select * from t2

-- Dml target tests, with columns
-- function call, select 
Insert dbo.f1() select * from t2 union select * from t3
Insert dbo.f1() (c1) default values
insert into dbo.tvf(1,-1,DEFAULT) values(2,3,4)
-- table with hints
Insert table1 with (HOLDLOCK) default values
Insert table1 with (NOWAIT, HOLDLOCK) (c2, c3) (select * from t1)
-- variable
Insert @v1 default values
Insert @v1 (..a1) ((select * from t1) union select * from t2)
-- open rowset
Insert OPENROWSET(something, @var1) default values
Insert OPENROWSET(something, @var1) (..a1, b.c) default values

-- execute statement 
insert dbo.t1 EXEC @varName

-- order by
insert into x
select top 1 y
from x
order by y

--query hint
insert into t2 select 1 option (fast 5, maxdop 2)
GO

--insert exec with return value
declare @iRetVal int
insert #TableSize ( TableName )
       exec @iRetVal = sp_spaceused 't1' 
