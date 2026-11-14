-- Tables with distinct names and schemas so Object Explorer filters produce distinguishable results.
CREATE SCHEMA sales;
GO
CREATE TABLE dbo.Customers (Id int PRIMARY KEY);
CREATE TABLE dbo.Orders (Id int PRIMARY KEY);
CREATE TABLE dbo.OrderLines (Id int PRIMARY KEY);
CREATE TABLE sales.Customers (Id int PRIMARY KEY);
CREATE TABLE sales.Invoices (Id int PRIMARY KEY);
GO
