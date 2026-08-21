-- Simple MERGE
MERGE a USING b
ON (a.ProductID = b.ProductID)
WHEN MATCHED
    THEN UPDATE SET pi.Quantity = src.OrderQty;

MERGE Production.ProductInventory AS pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID = src.ProductID)
WHEN MATCHED
    THEN UPDATE SET pi.Quantity = src.OrderQty;
GO

-- CTE, top row filter, no AS in alias, multiple actions
with DirReps(c1, c2) as (select c1 from t1)
MERGE top (2.5) percent INTO Production.ProductInventory pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID = src.ProductID)
WHEN MATCHED THEN 
	DELETE
WHEN NOT MATCHED AND src.OrderQty <> 0 THEN 
	INSERT DEFAULT VALUES
WHEN NOT MATCHED THEN 
	INSERT (c1) VALUES (10);
GO

with CHANGE_TRACKING_CONTEXT (0xff),
DirReps(c1, c2) as (select c1 from t1)
MERGE top (2.5) percent INTO Production.ProductInventory pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID = src.ProductID)
WHEN MATCHED THEN 
	DELETE
WHEN NOT MATCHED AND src.OrderQty <> 0 THEN 
	INSERT DEFAULT VALUES
WHEN NOT MATCHED THEN 
	INSERT (c1) VALUES (10);
GO
	
-- no alias, output clause, optimizer hints
MERGE Production.ProductInventory
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID = src.ProductID)
WHEN MATCHED
    THEN DELETE
output c1
OPTION(ALTERCOLUMN PLAN);	
GO
	
-- different conditions
MERGE pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID = src.ProductID)
WHEN NOT MATCHED BY TARGET THEN
	INSERT (c1) VALUES (10)
WHEN NOT MATCHED BY SOURCE THEN 
	DELETE;
GO

-- Pseudo columns in target
MERGE pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID = src.ProductID)
WHEN NOT MATCHED BY TARGET THEN
	INSERT ($ACTION, $CUID) VALUES (10);
GO

-- Index hint in DML target (it is only allowed in MERGE!)
MERGE pi WITH (INDEX (i1))
USING t1 ON (t1.ProductID = pi.ProductID)
WHEN NOT MATCHED BY SOURCE THEN 
	DELETE;
GO

-- Merge with INTO and OUTPUT clauses
MERGE INTO [dbo].[test] AS [tgt]
USING [dbo].[test] AS [ts] ON [tgt].[TestID] = [ts].[TestID]
WHEN MATCHED AND [tgt].[TestID] IS NOT NULL THEN DELETE OUTPUT [Inserted];
GO