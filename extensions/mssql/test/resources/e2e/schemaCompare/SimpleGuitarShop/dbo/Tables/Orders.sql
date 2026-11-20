CREATE TABLE [dbo].[Orders]
(
    [OrderID] INT NOT NULL IDENTITY(1, 1) PRIMARY KEY,
    [CustomerID] INT NOT NULL REFERENCES [dbo].[Customers] ([CustomerID]),
    [OrderDate] DATETIME2 NOT NULL
);
