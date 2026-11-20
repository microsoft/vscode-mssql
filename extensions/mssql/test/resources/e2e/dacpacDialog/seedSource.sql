-- Source database for the Dacpac Dialog suite: tables with primary and foreign keys, a view, a
-- stored procedure and a handful of rows, so extracted and exported packages carry real schema
-- and data.
CREATE TABLE dbo.Customers (
    CustomerId INT NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Email NVARCHAR(200) NULL
);
GO
CREATE TABLE dbo.Products (
    ProductId INT NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Price DECIMAL(10, 2) NOT NULL
);
GO
CREATE TABLE dbo.Orders (
    OrderId INT NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId INT NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES dbo.Customers (CustomerId),
    ProductId INT NOT NULL CONSTRAINT FK_Orders_Products REFERENCES dbo.Products (ProductId),
    Quantity INT NOT NULL,
    OrderDate DATE NOT NULL
);
GO
CREATE VIEW dbo.vw_OrderTotals
AS
SELECT o.OrderId, c.Name AS CustomerName, p.Name AS ProductName, o.Quantity * p.Price AS Total
FROM dbo.Orders AS o
    INNER JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId
    INNER JOIN dbo.Products AS p ON p.ProductId = o.ProductId;
GO
CREATE PROCEDURE dbo.usp_GetCustomerOrders
    @CustomerId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT OrderId, ProductName, Total
    FROM dbo.vw_OrderTotals
    WHERE OrderId IN (SELECT OrderId FROM dbo.Orders WHERE CustomerId = @CustomerId);
END
GO
INSERT INTO dbo.Customers (CustomerId, Name, Email) VALUES
    (1, N'Contoso', N'orders@contoso.com'),
    (2, N'Fabrikam', N'buy@fabrikam.com'),
    (3, N'Northwind', NULL);
INSERT INTO dbo.Products (ProductId, Name, Price) VALUES
    (10, N'Widget', 2.50),
    (20, N'Gadget', 12.00),
    (30, N'Gizmo', 7.25);
INSERT INTO dbo.Orders (OrderId, CustomerId, ProductId, Quantity, OrderDate) VALUES
    (100, 1, 10, 4, '2026-01-05'),
    (101, 1, 20, 1, '2026-01-06'),
    (102, 2, 30, 3, '2026-02-10'),
    (103, 3, 10, 10, '2026-03-15'),
    (104, 2, 20, 2, '2026-03-20');
