-- sacaglar, comments inline

-- testing four part name
select * from Sql2000.[MyDb].dbo.t1;
select * from .[MyDb].dbo.t1;
select * from ..dbo.t1;
select * from ...t1;

GO

-- testing function calls
-- testing default
select * from .[MyDb].dbo.func (default); 
-- testing empty inside paranthesis
select * from fun2();
-- testing multiple parameters
select * from fun2(-$10, 23, default, 'hello', N'Test');
--testing with alias
select * from fun2(-$10, 23, default, 'hello', N'Test') as table1, dbo.fun3() table2;

GO

-- Test simple alias
select c1 from t1 as table1, t3 table3;

GO

--Test tablehints
-- old force index syntax, when alias defined
select c1 from t1 table1 (1);
-- old holdlock, force index syntaxes
select c1 from t1 holdlock, t2 holdlock (0);

-- With old force index syntax
select c1 from t1 with (0);

-- without with
select c1 from t1 (nolock)

--with
select c1 from t1 with (holdlock, readpast, index = 0)

--nolock as both table hint and tvf parameter
select * from t1(nolock) cross apply dbo.tvf(nolock)

-- all the possible types, commas are optional
select c1 from t1 as table1 with (INDEX (0,1,ind2), HOLDLOCK, NOLOCK, PAGLOCK,
        READCOMMITTED, READPAST, READUNCOMMITTED, REPEATABLEREAD, ROWLOCK SERIALIZABLE 
        TABLOCK, TABLOCKX, UPDLOCK, XLOCK NOWAIT), t2 (nowait);

GO

-- holdlock, index hint after alias
select c1 from t1 t1_1 holdlock, t2 t2_1 (holdlock);
go

-- test builtin function call as table source
select c1 from ::functionName(), ::functionName() table1, ::functionName(1) as table1, ::functionName(1, null, default) as table1

-- test variable as table source
select c1 from @var1, @var2 [table 1], @var3 as table2;

GO

--Join Tests

--Cross Join
select * from t1 cross join t10

--Cross Join and paranthesis
select * from t1 cross join ( t10 cross join t11 )
select * from (((t1 cross join (( t10 cross join t11 )))))

--Cross Apply and paranthesis
select * from t1 cross apply ( t10 cross apply t11 )
select * from (((t1 cross apply (( t10 cross apply t11 )))))

--Outer Apply and paranthesis
select * from t1 outer apply ( t10 outer apply t11 )
select * from (((t1 outer apply (( t10 outer apply t11 )))))

--Qualified Joins
select * from t1 join t10 on t1.c1 = t10.c1
select * from t1 inner join t10 on t1.c1 = t10.c1
select * from t1 left join t10 on t1.c1 = t10.c1
select * from t1 left outer join t10 on t1.c1 = t10.c1
select * from t1 right join t10 on t1.c1 = t10.c1
select * from t1 right outer join t10 on t1.c1 = t10.c1
select * from t1 full join t10 on t1.c1 = t10.c1
select * from t1 full outer join t10 on t1.c1 = t10.c1

--Join Hints
select * from t1 inner merge join t10 on t1.c1 = t10.c1
select * from t1 inner hash join t10 on t1.c1 = t10.c1
select * from t1 inner loop join t10 on t1.c1 = t10.c1
select * from t1 inner remote join t10 on t1.c1 = t10.c1

--Test of undocumented feature in books online
select * from t1 inner local merge join t10 on t1.c1 = t10.c1
select * from t1 inner local hash join t10 on t1.c1 = t10.c1
select * from t1 inner local loop join t10 on t1.c1 = t10.c1

-- multiple joins
select * from t1 inner remote join t10 left join t11 on t10.c1 > t11.c1 on t1.c1 = t10.c1
select * from (t1 inner remote join (t10 left join t11 on t10.c1 > t11.c1) on t1.c1 = t10.c1)

-- multiple join paranthesis
select * from (((((((((((((((((((((select * from t1) as t10 join (select * from t2) as t20 on t10.c1 = t20.c2))))))))))))))))))))

-- multiple joins and unions
select * from (((select * from t1 union all select * from t1) union select * from t1)) as t10 join (select * from t2) as t20 on t10.c1 = t20.c2
select * from (((select * from t1 union all select * from t1) as t10 join (select * from t2) as t20 on t10.c1 = t20.c2) join (select * from t3) as t30 on t20.c2 = t30.c3)

-- testing derived tables
select * from (select a = c1, c2 b from t1) t10 (c1)
select * from (select * from t1) t10 (c1,c2) cross join t2
select * from ((select * from t1) as t10 join t2 on t10.c1 = t2.c1) 

-- Testing ODBC joins
select * from {oj {oj t1 inner join t2 on c1 < 10}}
select * from {oj t1 inner join t2 on c1 < 10 inner join t3 on c1 < 10}
select * from {oj t1 cross join t2 inner join t2 on c1 < 10}
select * from {oj (t1 cross join t2) inner join t2 on c1 < 10}
select * from t1 inner join {oj t1 cross join t2 inner join t2 on c1 < 10} on c1 < 10 cross join t3

-- columns after schemaObjectTableSource
select jc.[JobCandidateID] FROM [HumanResources].[JobCandidate] jc 
CROSS APPLY jc.[Resume].nodes(N'declare default element namespace "http://schemas.microsoft.com/sqlserver/2004/07/adventure-works/Resume"; 
    /Resume/Employment') AS Employment(ref);

-- expression in schemaObjectTableSource    
SELECT ecp.* FROM sys.dm_exec_cached_plans ecp OUTER APPLY sys.dm_exec_plan_attributes(ecp.plan_handle) epa

-- table hint before alias - VS Whidbey 606192
SELECT au_id  from [dbo].[Authors] (nolock) as auth WHERE auth.au_lname = @au_lname

-- schema object or table reference tests
SELECT *
FROM t WITH (NOLOCK);

SELECT *
FROM t AS s WITH (NOLOCK);

SELECT *
FROM t1 WITH (NOLOCK) CROSS APPLY dbo.tvf WITH (NOLOCK);

SELECT *
FROM t AS s WITH (NOLOCK);

SELECT *
FROM t WITH (NOLOCK);

SELECT *
FROM t AS s WITH (NOLOCK);
