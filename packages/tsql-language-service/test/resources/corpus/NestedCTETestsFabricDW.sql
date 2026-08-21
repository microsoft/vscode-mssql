WITH Orders_Summary
AS (SELECT CustomerID,
           COUNT(*) AS OrderCount,
           SUM(Amount) AS TotalAmount
    FROM Orders
    GROUP BY CustomerID)
SELECT CustomerID,
       OrderCount,
       TotalAmount
FROM Orders_Summary
WHERE OrderCount > 5;

WITH Regional_Analysis
AS (WITH Sales_Data
    AS (SELECT RegionID,
               ProductID,
               SUM(Amount) AS Sales
        FROM Sales
        GROUP BY RegionID, ProductID)
    SELECT RegionID,
           COUNT(ProductID) AS ProductCount,
           SUM(Sales) AS TotalSales
    FROM Sales_Data
    GROUP BY RegionID)
SELECT RegionID,
       ProductCount,
       TotalSales
FROM Regional_Analysis
WHERE TotalSales > 10000;

WITH Final_Report
AS (WITH Department_Summary
    AS (WITH Employee_Data
        AS (SELECT DepartmentID,
                   EmployeeID,
                   Salary
            FROM Employees
            WHERE IsActive = 1)
        SELECT DepartmentID,
               COUNT(EmployeeID) AS EmpCount,
               AVG(Salary) AS AvgSalary
        FROM Employee_Data
        GROUP BY DepartmentID)
    SELECT DepartmentID,
           EmpCount,
           AvgSalary,
           CASE WHEN AvgSalary > 50000 THEN 'High' ELSE 'Low' END AS SalaryLevel
    FROM Department_Summary)
SELECT DepartmentID,
       EmpCount,
       AvgSalary,
       SalaryLevel
FROM Final_Report
ORDER BY AvgSalary DESC;