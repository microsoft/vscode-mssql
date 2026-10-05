-- Deterministic perf harness seed database (design §13.4, §29).
-- Non-sensitive synthetic data only. Idempotent: drops and recreates.
-- Applied by the SQL provisioner before measurement reps (snapshot "seed-v1").

IF DB_ID(N'PerfHarness') IS NOT NULL
BEGIN
    ALTER DATABASE PerfHarness SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE PerfHarness;
END;
GO

CREATE DATABASE PerfHarness;
GO

USE PerfHarness;
GO

-- ---------------------------------------------------------------------------
-- 10k-row query fixture: fully deterministic content (no NEWID/GETDATE).
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.PerfRows (
    Id INT NOT NULL PRIMARY KEY,
    Category NVARCHAR(32) NOT NULL,
    Label NVARCHAR(64) NOT NULL,
    Amount DECIMAL(18, 4) NOT NULL,
    CreatedOn DATETIME2(0) NOT NULL,
    Payload NVARCHAR(256) NOT NULL
);
GO

;WITH N AS (
    SELECT TOP (10000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO dbo.PerfRows (Id, Category, Label, Amount, CreatedOn, Payload)
SELECT
    n,
    N'category-' + CAST(n % 10 AS NVARCHAR(2)),
    N'row-' + CAST(n AS NVARCHAR(10)),
    CAST(n AS DECIMAL(18, 4)) / 7.0,
    DATEADD(SECOND, n, '2026-01-01T00:00:00'),
    REPLICATE(N'x', 200) -- fixed-width payload keeps row size deterministic
FROM N;
GO

-- ---------------------------------------------------------------------------
-- Object Explorer shape: a small, stable set of objects for expand scenarios.
-- ---------------------------------------------------------------------------
CREATE SCHEMA sales;
GO
CREATE SCHEMA reporting;
GO

CREATE TABLE sales.Customers (
    CustomerId INT NOT NULL PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Region NVARCHAR(50) NOT NULL
);
CREATE TABLE sales.Orders (
    OrderId INT NOT NULL PRIMARY KEY,
    CustomerId INT NOT NULL REFERENCES sales.Customers (CustomerId),
    OrderedOn DATETIME2(0) NOT NULL,
    Total DECIMAL(18, 2) NOT NULL
);
CREATE TABLE sales.OrderLines (
    OrderId INT NOT NULL REFERENCES sales.Orders (OrderId),
    LineNumber INT NOT NULL,
    Sku NVARCHAR(32) NOT NULL,
    Quantity INT NOT NULL,
    PRIMARY KEY (OrderId, LineNumber)
);
CREATE TABLE reporting.DailyTotals (
    Day DATE NOT NULL PRIMARY KEY,
    OrderCount INT NOT NULL,
    Revenue DECIMAL(18, 2) NOT NULL
);
GO

CREATE VIEW sales.vw_CustomerOrders
AS
SELECT c.CustomerId, c.Name, o.OrderId, o.OrderedOn, o.Total
FROM sales.Customers c
JOIN sales.Orders o ON o.CustomerId = c.CustomerId;
GO

CREATE PROCEDURE sales.usp_TopCustomers
    @topN INT = 10
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@topN) c.CustomerId, c.Name, SUM(o.Total) AS Revenue
    FROM sales.Customers c
    JOIN sales.Orders o ON o.CustomerId = c.CustomerId
    GROUP BY c.CustomerId, c.Name
    ORDER BY Revenue DESC;
END;
GO

CREATE FUNCTION sales.fn_OrderTotal (@orderId INT)
RETURNS DECIMAL(18, 2)
AS
BEGIN
    RETURN (SELECT Total FROM sales.Orders WHERE OrderId = @orderId);
END;
GO

-- ---------------------------------------------------------------------------
-- 100k-row fixture for virtual-window / large-result scenarios (Phase 3).
-- Deterministic content; Id is the correctness key at any scroll offset.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.PerfRows100k (
    Id INT NOT NULL PRIMARY KEY,
    Category NVARCHAR(32) NOT NULL,
    Label NVARCHAR(64) NOT NULL,
    Amount DECIMAL(18, 4) NOT NULL
);
GO

;WITH N AS (
    SELECT TOP (100000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO dbo.PerfRows100k (Id, Category, Label, Amount)
SELECT n, N'cat-' + CAST(n % 20 AS NVARCHAR(3)), N'row-' + CAST(n AS NVARCHAR(10)),
       CAST(n AS DECIMAL(18, 4)) / 11.0
FROM N;
GO

-- ---------------------------------------------------------------------------
-- Blob/XML/MAX-type fixture (Phase 3): deterministic large cells.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.PerfBlobs (
    Id INT NOT NULL PRIMARY KEY,
    BinPayload VARBINARY(MAX) NOT NULL,
    XmlPayload XML NOT NULL,
    TextPayload NVARCHAR(MAX) NOT NULL
);
GO

;WITH N AS (
    SELECT TOP (20) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_columns
)
INSERT INTO dbo.PerfBlobs (Id, BinPayload, XmlPayload, TextPayload)
SELECT
    n,
    CAST(REPLICATE(CAST(CHAR(65 + n % 26) AS VARCHAR(MAX)), 262144) AS VARBINARY(MAX)), -- 256KB deterministic letter fill
    CAST(N'<root id="' + CAST(n AS NVARCHAR(10)) + N'">' + REPLICATE(CAST(N'<item>x</item>' AS NVARCHAR(MAX)), 500) + N'</root>' AS XML),
    REPLICATE(CAST(N'lorem-' + CAST(n AS NVARCHAR(10)) + N' ' AS NVARCHAR(MAX)), 8192)
FROM N;
GO

-- Deterministic small data for the OE-shape tables.
;WITH N AS (
    SELECT TOP (100) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM sys.all_columns
)
INSERT INTO sales.Customers (CustomerId, Name, Region)
SELECT n, N'Customer ' + CAST(n AS NVARCHAR(10)), N'region-' + CAST(n % 5 AS NVARCHAR(2))
FROM N;

;WITH N AS (
    SELECT TOP (500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO sales.Orders (OrderId, CustomerId, OrderedOn, Total)
SELECT n, (n % 100) + 1, DATEADD(HOUR, n, '2026-01-01T00:00:00'), CAST(n % 997 AS DECIMAL(18, 2))
FROM N;
GO
