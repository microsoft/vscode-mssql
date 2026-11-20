-- Schema Designer canvas e2e fixture: tables in two schemas linked by foreign keys.
CREATE SCHEMA Sales;
GO
CREATE TABLE dbo.Customers (
    Id INT NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Email NVARCHAR(200) NULL
);
CREATE TABLE dbo.CustomerNotes (
    Id INT NOT NULL CONSTRAINT PK_CustomerNotes PRIMARY KEY,
    CustomerId INT NOT NULL CONSTRAINT FK_CustomerNotes_Customers REFERENCES dbo.Customers (Id),
    Note NVARCHAR(400) NULL
);
CREATE TABLE dbo.Products (
    Id INT NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    ProductName NVARCHAR(100) NOT NULL
);
CREATE TABLE Sales.Orders (
    Id INT NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId INT NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES dbo.Customers (Id),
    OrderDate DATETIME2 NOT NULL
);
CREATE TABLE Sales.OrderLines (
    Id INT NOT NULL CONSTRAINT PK_OrderLines PRIMARY KEY,
    OrderId INT NOT NULL CONSTRAINT FK_OrderLines_Orders REFERENCES Sales.Orders (Id),
    ProductId INT NOT NULL CONSTRAINT FK_OrderLines_Products REFERENCES dbo.Products (Id),
    Quantity INT NOT NULL
);
GO
