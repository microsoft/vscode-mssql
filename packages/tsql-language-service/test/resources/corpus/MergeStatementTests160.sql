-- Simple MERGE using IS [NOT] DISTINCT FROM
MERGE a USING b
ON (a.ProductID IS NOT DISTINCT FROM b.ProductID)
WHEN MATCHED
    THEN UPDATE SET pi.Quantity = src.OrderQty;

MERGE Production.ProductInventory AS pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID IS NOT DISTINCT FROM src.ProductID)
WHEN MATCHED
    THEN UPDATE SET pi.Quantity = src.OrderQty;
	
MERGE Production.ProductInventory AS pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID IS NOT DISTINCT FROM NULL)
WHEN MATCHED
    THEN UPDATE SET pi.Quantity = src.OrderQty;
	
MERGE Production.ProductInventory AS pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID IS NOT DISTINCT FROM (SELECT MAX(ProductID) FROM src))
WHEN MATCHED
    THEN UPDATE SET pi.Quantity = src.OrderQty;
	
MERGE Production.ProductInventory AS pi
USING (SELECT * FROM someTable) AS src
ON (pi.ProductID IS NOT DISTINCT FROM 100)
WHEN MATCHED
    THEN UPDATE SET pi.Quantity = src.OrderQty;
GO