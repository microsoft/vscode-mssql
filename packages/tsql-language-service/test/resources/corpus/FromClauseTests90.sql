-- testing table sample clause
select * from .[MyDb].dbo.t1 tablesample (12 + 3)

select * from fun2 tablesample system (12 + 3 percent) repeatable (-100) 

select * from t1 as table1 tablesample (12 + 3 rows)

GO

-- all kinds of expressions in builtInFunctionTableSource
select * from master..sysprocesses p cross apply ::fn_get_sql(p.sql_handle)

select * from ::f1(a.b*(12+20))

select * from ::f2(default)

GO

-- 90 table hints
select c1 from t1 as table1 with (READCOMMITTEDLOCK, KEEPIDENTITY, 
    KEEPDEFAULTS, IGNORE_CONSTRAINTS IGNORE_TRIGGERS);

GO

-- test variable (with UDT calls) as table source
select c1 from @var1.f(default, @c * 23) t(c), @var2.f() [table 1](c,c2), @var3.[g](a.b::C) as table2(c), @var1.f(default, @c * 23) t(c1, c2), @var3.[g](a.b::C) as table2 (c1);

GO

-- testing pivot and unpivot
SELECT VendorID, [164] AS Emp1, [198] AS Emp2, [223] AS Emp3, [231] AS Emp4, [233] AS Emp5
FROM 
(SELECT PurchaseOrderID, EmployeeID, VendorID
FROM Purchasing.PurchaseOrderHeader) p
PIVOT
(
COUNT (PurchaseOrderID)
FOR EmployeeID IN
( [164], [198], [223], [231], [233] )
) AS pvt
ORDER BY VendorID
GO

SELECT VendorID, Employee, Orders
FROM 
   (SELECT VendorID, Emp1, Emp2, Emp3, Emp4, Emp5
   FROM pvt) p
UNPIVOT
   (Orders FOR Employee IN 
      (Emp1, Emp2, Emp3, Emp4, Emp5)
)AS unpvt

-- Pivot with multi-part column names
SELECT * FROM st
PIVOT
(
	AVG(.st.StandardCost)
	FOR st.DaysToManufacture IN ([0], [1])
) AS PivotTable;

GO
-- testing pivot and unpivot mixed with joins
select * from t1 pivot (dbo.f(c1) for [if] in (a)) as PTable cross join t2 unpivot(c2 for T2 in ([a], b)) UPTable
select * from t1 inner remote join (t10 left join t11 on t10.c1 > t11.c1) on t1.c1 = t10.c1 pivot (dbo.f(c1) for[if] in (a)) PTable

-- unpivot with qualified columns
select * from t1 cross apply t2 unpivot (q for n in (t1.c0, c1)) as a

--FOR XML in Derived Table
select * from (SELECT * FROM t1 FOR XML AUTO) t(c1)
GO

-- schema object or table reference with tablesample
select * from authors t1 tablesample (1000 rows)(nolock) 

select * from authors t1 tablesample (1000 rows) with (nolock) 

select * from authors tablesample (1000 rows) with (holdlock)
