CREATE TABLE [dbo].[Orders]
(
    [OrderId] INT NOT NULL PRIMARY KEY,
    [CustomerId] INT NOT NULL,
    [Total] DECIMAL (10, 2) NOT NULL,
    CONSTRAINT [FK_Orders_Customer] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customer] ([CustomerId])
);
