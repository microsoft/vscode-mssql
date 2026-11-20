CREATE VIEW [dbo].[CustomerOrders]
AS
SELECT c.[CustomerId], c.[Name], o.[OrderId], o.[Total]
FROM [dbo].[Customer] AS c
INNER JOIN [dbo].[Orders] AS o ON o.[CustomerId] = c.[CustomerId];
