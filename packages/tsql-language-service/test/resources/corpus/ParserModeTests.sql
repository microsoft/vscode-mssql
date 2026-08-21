-- sacaglar, this script tests the TSql80 mode, additional comments inline...

-- The column names are keywords in TSql90, here they are identifiers.
create table t1
	(
		eXTERrnal int,
		pivoT int,
		revert int,
		tableSample int,
		UnPivot int
	)
GO

-- Precision is only a keyword in TSql80, TSql90 is covered by a ScalarDataTypeTests.sql
create table t1
	(
	c38 Double Precision not null
	)

GO

select * from (select a = c1, c2 b from t1 for browse) as t10
select * from (select top 5 a = c1, c2 b from t1 order by c2 for browse) t10
select * from ((select top 5 * from t1 order by c2 for browse) as t10 join t2 on t10.c1 = t2.c1) 

GO

BACKUP LOG MyNwind TO DISK = 'C:\MyNwind.log'

