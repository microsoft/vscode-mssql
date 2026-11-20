CREATE TABLE [dbo].[OrderItems]
(
    [ItemID] INT NOT NULL IDENTITY(1, 1) PRIMARY KEY,
    [OrderID] INT NOT NULL REFERENCES [dbo].[Orders] ([OrderID]),
    [ProductID] INT NOT NULL REFERENCES [dbo].[Products] ([ProductID]),
    [Quantity] INT NOT NULL
);
