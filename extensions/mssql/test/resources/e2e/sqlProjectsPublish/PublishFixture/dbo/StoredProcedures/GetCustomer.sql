CREATE PROCEDURE [dbo].[GetCustomer]
    @CustomerId INT
AS
BEGIN
    SELECT [CustomerId], [Name] FROM [dbo].[Customer] WHERE [CustomerId] = @CustomerId;
END
