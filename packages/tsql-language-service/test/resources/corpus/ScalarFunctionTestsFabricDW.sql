CREATE OR ALTER FUNCTION dbo.GetFullName
(@firstName NVARCHAR (50)='John', @lastName NVARCHAR (50))
RETURNS NVARCHAR (101)
WITH SCHEMABINDING, RETURNS NULL ON NULL INPUT
AS
BEGIN
    RETURN @firstName + ' ' + @lastName;
END


GO
CREATE OR ALTER FUNCTION dbo.CalculateTotal
(@price DECIMAL (10, 2), @quantity INT=1)
RETURNS DECIMAL (10, 2)
WITH EXECUTE AS SELF, CALLED ON NULL INPUT
AS
BEGIN
    RETURN @price * @quantity;
END


GO
CREATE OR ALTER FUNCTION sales.ComputeDiscount
(@amount FLOAT, @discount FLOAT)
RETURNS FLOAT
WITH RETURNS NULL ON NULL INPUT
AS
BEGIN
    RETURN @amount - (@amount * @discount / 100);
END


GO
CREATE FUNCTION dbo.GetFullName
(@FirstName VARCHAR (50), @LastName VARCHAR (50))
RETURNS VARCHAR (101)
AS
BEGIN
    RETURN @FirstName + ' ' + @LastName;
END

GO
CREATE FUNCTION dbo.ConvertInput
(@MyValueIn INT)
RETURNS DECIMAL (10, 2)
AS
BEGIN
    DECLARE @MyValueOut AS INT;
    SET @MyValueOut = CAST (@MyValueIn AS DECIMAL (10, 2));
    RETURN (@MyValueOut);
END
GO
SELECT dbo.ConvertInput(15) AS 'ConvertedValue';