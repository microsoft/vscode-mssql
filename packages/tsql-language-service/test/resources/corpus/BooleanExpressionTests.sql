-- sacaglar: This script has both check constraint and boolean expression tests.
-- It tests all the booleanExpressionPrimary and some check constraint functionality.

CREATE TABLE A_Schema.A_TABLE (	
	A1 int constraint cons1 check (A1 < 4),
	A2 int check not for replication (A2 <> 21),
	A3 int,
	A4 int,
	constraint cons2 check (A3 != A4),
	check not for replication (A4 is not null),
	check (A1 is null 
		AND A2 > 34 
		OR A3 is not null 
		AND NOT A4 = 23 
		AND NOT NOT A1 < 23 
		OR A2 <= 1000 
		AND A4 !< 830
		AND A3 !> 10000
		OR A2 >= 98),
	check (A1 in (23, -23, +100, ~1)),
	check (A1 not in (90)),
	check (A1 between -992 and ~923),
	Check not for replication (A2 not between 394 and 122),
	check ((Case When col1 = 1 Then 1 else 0 end) = 0),
	check (A1 is null 
		AND (A2 > 34)
		OR (A3 is not null)
		AND NOT A4 = (23)
		AND ((NOT NOT A1 < 23)
		OR (A2 <= 1000 
		AND A4 !< 830
		AND A3 !> 10000
		OR A2 >= 98))
		),
    check ((A1 in (23, -23, +100, ~1))),
	check ((A1 between -992 and ~923)),
    check ((((100 > A1)))),
    check (A1 like 'foo'),
    check (A1 not like '50%% off when 100 or more copies are purchased'),
    check (A1 like '50%% off when 100 or more copies are purchased' ESCAPE '%'),
    check (A1 like '50%% off when 100 or more copies are purchased' {ESCAPE '%'})
)
;
GO

SELECT e.FirstName, e.LastName, ep.Rate
FROM HumanResources.vEmployee e 
JOIN HumanResources.EmployeePayHistory ep 
    ON e.BusinessEntityID = ep.BusinessEntityID
WHERE ep.Rate BETWEEN 27 AND 30
ORDER BY ep.Rate;
GO

SELECT Name
FROM Production.Product
WHERE CONTAINS(Name, ' "Mountain" OR "Road" ')
GO

GO
SELECT a.FirstName, a.LastName
FROM Person.Person AS a
WHERE EXISTS
(SELECT * 
    FROM HumanResources.Employee AS b
    WHERE a.BusinessEntityID = b.BusinessEntityID
    AND a.LastName = 'Johnson');
GO

GO
SELECT Title
FROM Production.Document
WHERE FREETEXT (Document, 'vital safety components' );
GO

SELECT Title
FROM Production.Document
WHERE CONTAINS (($identity), @a);
GO

SELECT Title
FROM Production.Document
WHERE Freetext ( t2.*, N'abc');
GO

SELECT Title
FROM Production.Document
WHERE Freetext ( (t2.*), N'abc');
GO


SELECT Title
FROM Production.Document
WHERE Freetext ( (t2.c1), N'abc', language 0x413);
GO

SELECT Title
FROM Production.Document
WHERE Freetext ( (t2.c1, c2, c3), N'abc', language 'English');
GO

SELECT Title
FROM Production.Document
WHERE Freetext ( t2.c1, N'abc', language @current);
GO

SELECT Title
FROM Production.Document
WHERE Freetext ( c1, N'abc');
GO

SELECT Title
FROM Production.Document
WHERE tsequal(convert(timestamp, getdate()), convert(timestamp, getdate()));
GO

SELECT Title
FROM Production.Document
WHERE update(id);
GO

SELECT Title
FROM Production.Document
WHERE (update(id));
GO

SELECT Title
FROM Production.Document
WHERE Contains ( t1.c1, @a);
GO

SELECT Title
FROM Production.Document
WHERE (Contains ( t1.c1, @a));
GO

SELECT Title
FROM Production.Document
WHERE Freetext ( t2.*, N'abc');
GO

SELECT Title
FROM Production.Document
WHERE Contains ( (t1.c1, c2, t2.c1), @a);
GO

SELECT Title
FROM Production.Document
WHERE Contains ( (t1.c1, c2, t2.c1), @a, language 1043);
GO

SELECT Title
FROM Production.Document
WHERE Contains ( (*), @a);
GO

SELECT Title
FROM Production.Document
WHERE CONTAINS ((t1.$identity), @a);
GO

SELECT p.FirstName, p.LastName, e.JobTitle
FROM Person.Person p
JOIN HumanResources.Employee AS e
    ON p.BusinessEntityID = e.BusinessEntityID
WHERE e.JobTitle IN ('Design Engineer', 'Tool Designer', 'Marketing Assistant');
GO

SELECT Name, Weight, Color
FROM Production.Product
WHERE Weight < 10.00 OR Color IS NULL
ORDER BY Name;
GO

SELECT * 
FROM t 
WHERE RTRIM(col1) LIKE '% King'
GO

CREATE TRIGGER reminder
ON Person.Address
AFTER UPDATE 
AS 
IF ( UPDATE (StateProvinceID) OR UPDATE (PostalCode) )
BEGIN
RAISERROR (50009, 16, 10)
END;
GO

if dbo.ISOWeek() = 110 print 'hi'
GO

-- Select statement's paranthesis might be confused with boolean paranthesis.
CREATE PROCEDURE p1 
AS
SELECT 
      CASE 
            WHEN (isnull( (SELECT  1 FROM dbo.[syscomments] WHERE 1 = 1) , 0 ) ) = 0
            THEN 0
            ELSE  14
            END 
FROM
      dbo.[syscomments] 
GO

CREATE PROCEDURE p1 
AS
SELECT 
      CASE 
            WHEN (isnull( (SELECT  1 FROM dbo.[syscomments] WHERE (1 = 1)) , 0 ) ) = 0
            THEN 0
            ELSE  14
            END 
FROM
      dbo.[syscomments] 
GO

CREATE PROCEDURE p1 
AS
SELECT 
      CASE 
            WHEN ((isnull( (SELECT  1 FROM dbo.[syscomments] WHERE 1 = 1) , 0 ) ) = 0)
            THEN 0
            ELSE  14
            END 
FROM
      dbo.[syscomments] 
GO

if ((select 1) = 2)
print 'yes'

GO

CREATE PROCEDURE getOrders
AS
SELECT OrderID, OrderDate, ShippedDate
FROM Orders
WHERE CustomerID IN ((SELECT CustomerID FROM Customers WHERE CustomerID = 'ALFKI'), 
(SELECT CustomerID FROM Customers WHERE CustomerID = 'ANATR'),
(SELECT CustomerID FROM Customers WHERE CustomerID = 'ANTON'))
