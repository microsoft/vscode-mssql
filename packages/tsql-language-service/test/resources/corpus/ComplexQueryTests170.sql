SELECT 139 AS [p_1_0]
FROM   (
[dbo].[table_0] AS [alias_1_0] CROSS JOIN 
((
[dbo].[table_6] AS [alias_1_4]
RIGHT OUTER JOIN
[dbo].[table_3] AS [alias_1_5]
ON [alias_1_4].[c_19] = CAST ('[-6.464173E+08,1.040823E+07,1.699169E+08]' AS VECTOR (3))
)))


SELECT CAST('test' AS VECTOR (3, Float32))

SELECT CAST('test' AS VECTOR(3, Float32))

SELECT 1 WHERE col = CAST('test' AS VECTOR (3, Float32));

SELECT 1 WHERE col IN (SELECT CAST('test' AS VECTOR (3, Float32)));

-- Complex query with nested subqueries and various joins with  VECTOR(3, Float32)
SELECT CAST ($492050157978986.2129 AS MONEY) AS [p_0_0]
FROM   ([dbo].[table_6] AS [alias_0_0] CROSS JOIN [dbo].[table_4] AS [alias_0_1])
WHERE  (NOT (SYSDATETIME() IN (SELECT 139 AS [p_1_0]
FROM   ([dbo].[table_0] AS [alias_1_0] CROSS JOIN ([dbo].[table_6] AS [alias_1_1]
 LEFT OUTER JOIN
([dbo].[table_6] AS [alias_1_2]
 INNER JOIN
([dbo].[table_5] AS [alias_1_3] CROSS APPLY ([dbo].[table_6] AS [alias_1_4]
RIGHT OUTER JOIN
[dbo].[table_3] AS [alias_1_5]
ON [alias_1_4].[c_19] = CAST ('[-6.464173E+08,1.040823E+07,1.699169E+08]' AS VECTOR (3, Float32))))
ON [alias_1_2].[c_14] = [alias_1_3].[c_13])
ON [alias_1_1].[c_1] = CONVERT (VECTOR (77), '[-7.230808E+08,4.075427E+08]'))))
OR (CONVERT (BIGINT, CONVERT (INT, 8)) >= 157)
OR (140 <= 19)))

-- Complex query with nested subqueries and various joins with  VECTOR(3)
SELECT CAST ($492050157978986.2129 AS MONEY) AS [p_0_0]
FROM   ([dbo].[table_6] AS [alias_0_0] CROSS JOIN [dbo].[table_4] AS [alias_0_1])
WHERE  (NOT (SYSDATETIME() IN (SELECT 139 AS [p_1_0]
FROM   ([dbo].[table_0] AS [alias_1_0] CROSS JOIN ([dbo].[table_6] AS [alias_1_1]
 LEFT OUTER JOIN
([dbo].[table_6] AS [alias_1_2]
 INNER JOIN
([dbo].[table_5] AS [alias_1_3] CROSS APPLY ([dbo].[table_6] AS [alias_1_4]
RIGHT OUTER JOIN
[dbo].[table_3] AS [alias_1_5]
ON [alias_1_4].[c_19] = CAST ('[-6.464173E+08,1.040823E+07,1.699169E+08]' AS VECTOR (3))))
ON [alias_1_2].[c_14] = [alias_1_3].[c_13])
ON [alias_1_1].[c_1] = CONVERT (VECTOR (77), '[-7.230808E+08,4.075427E+08]'))))
OR (CONVERT (BIGINT, CONVERT (INT, 8)) >= 157)
OR (140 <= 19)))

-- Complex query involving multiple joins, CROSS APPLY, and filtering conditions
SELECT TOP 100 t1.order_id, t1.customer_id, t2.product_name, t3.category_name
FROM   ([dbo].[orders] AS t1 
        CROSS JOIN ([dbo].[order_items] AS t2
                    LEFT OUTER JOIN
                    ([dbo].[products] AS t3
                     INNER JOIN
                     ([dbo].[categories] AS t4 
                      CROSS APPLY ([dbo].[suppliers] AS t5
                                   RIGHT OUTER JOIN
                                   [dbo].[regions] AS t6
                                   ON t5.region_id = t6.id AND t5.active = 1))
                     ON t3.category_id = t4.id)
                    ON t2.product_id = t3.id))
WHERE  (t1.order_date >= '2025-01-01' 
        AND t2.quantity > 0
        AND EXISTS (SELECT 1 FROM [dbo].[inventory] AS inv 
                    WHERE inv.product_id = t2.product_id 
                    AND inv.stock_level > 10))