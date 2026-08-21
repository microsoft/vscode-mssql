-- Select statement basics
Create View schema1.view1 (a, b, c, d, jacl)
   WITH ENCRYPTION, SCHEMABINDING, VIEW_METADATA 
      AS SELECT * FROM schema1.table2
		WITH CHECK OPTION
GO

Create View schema1.view1 (a, b, c, d, jacl)
   WITH ENCRYPTION, SCHEMABINDING, VIEW_METADATA 
      AS SELECT * FROM schema1.table2
GO

Create View view1 (a, b, c, d, jacl)
   WITH ENCRYPTION, SCHEMABINDING, VIEW_METADATA 
      AS SELECT * FROM schema1.table2
GO

Create View schema1.view1 
   WITH ENCRYPTION, SCHEMABINDING, VIEW_METADATA 
      AS SELECT * FROM schema1.table2
GO

Alter View schema1.view1 (a, b, c, d, jacl)  
      AS SELECT * FROM schema1.table2
GO

Alter View View1  
      AS SELECT * FROM Table1
GO

Alter View schema1.view1 
   WITH SCHEMABINDING 
      AS SELECT c1, c2 FROM schema1.table2
GO

create view v1 as select * from t1

GO

create view v1 as select * from t1 with check option

GO

create view "Category Sales for 1997" AS
SELECT "Product Sales for 1997".CategoryName, Sum("Product Sales for 1997".ProductSales) AS CategorySales
FROM "Product Sales for 1997"
GROUP BY "Product Sales for 1997".CategoryName
go