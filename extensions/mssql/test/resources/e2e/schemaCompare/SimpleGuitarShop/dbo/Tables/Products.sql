CREATE TABLE [dbo].[Products]
(
    [ProductID] INT NOT NULL IDENTITY(1, 1) PRIMARY KEY,
    [CategoryID] INT NOT NULL REFERENCES [dbo].[Categories] ([CategoryID]),
    [ProductCode] NVARCHAR(10) NOT NULL UNIQUE,
    [ProductName] NVARCHAR(255) NOT NULL,
    [ListPrice] MONEY NOT NULL
);
