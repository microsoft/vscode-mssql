DECLARE @SQL NVARCHAR(max)
SET @SQL = N'SELECT a FROM t1 WHERE 1 = 1'
exec(@SQL)
with RESULT SETS((Dobidoo BIGINT NOT NULL))
go
execute p1 with result sets none
go
execute p1 with result sets undefined
go
execute p1 with result sets (AS OBJECT server1.db.dbo.t1, (c1 int null), AS FOR XML, AS TYPE dbo.type1)
go
execute p1 with result sets none, recompile
go
execute p1 with recompile, result sets undefined
go