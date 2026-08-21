--Collation added to UDT property access
SELECT t::a COLLATE Albanian_BIN
GO
SELECT (c1).SomeProperty COLLATE Albanian_BIN
GO
-- meaning of this is somewhat questionable - might not pass symantic check in SQL Server
SELECT c1.f1().SomeProperty COLLATE Albanian_BIN .AnotherProperty COLLATE Albanian_BIN
GO

-- user-defined aggregate with multiple parameters
SELECT dbo.MyAgg(ALL c1, c2, 10) OVER ()
GO
SELECT dbo.MyAgg(DISTINCT c1, c2, 10)
GO