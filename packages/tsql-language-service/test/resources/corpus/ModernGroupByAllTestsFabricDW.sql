SELECT City,
       Region,
       COUNT(*) AS NumEmps
FROM dbo.Employees
GROUP BY ALL;
GO

SELECT City,
       COUNT(*) AS NumEmps
FROM dbo.Employees
WHERE HireDate >= '19930101'
GROUP BY ALL
HAVING COUNT(*) > 5
ORDER BY City;
GO

SELECT Region,
       YEAR(OrderDate) AS OrderYear,
       Category,
       COUNT(*) AS NumOrders,
       SUM(Amount) AS Total
FROM Sales
WHERE Amount > 0
GROUP BY ALL;
GO

SELECT c.CustomerName,
       COUNT(*) AS Orders
FROM Orders AS o
     INNER JOIN
     Customers AS c
     ON o.CustomerId = c.CustomerId
GROUP BY ALL;
GO

SELECT City,
       COUNT(*) AS NumEmps
FROM dbo.Employees
GROUP BY ALL
ORDER BY City DESC;
GO

SELECT *
FROM (SELECT City,
             COUNT(*) AS Cnt
      FROM dbo.Employees
      GROUP BY ALL) AS t;
GO

SELECT Region,
       SUM(Amount) / COUNT(DISTINCT CustomerId) AS AvgSpend
FROM Sales
GROUP BY ALL;
GO

CREATE VIEW v_GroupByAllView
AS
SELECT City,
       COUNT(*) AS NumEmps
FROM dbo.Employees
GROUP BY ALL;
GO

CREATE PROCEDURE usp_GroupByAll
AS
BEGIN
    SELECT City,
           COUNT(*) AS NumEmps
    FROM dbo.Employees
    GROUP BY ALL;
END
