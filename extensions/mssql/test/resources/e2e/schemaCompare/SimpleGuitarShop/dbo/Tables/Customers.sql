CREATE TABLE [dbo].[Customers]
(
    [CustomerID] INT NOT NULL IDENTITY(1, 1) PRIMARY KEY,
    [EmailAddress] NVARCHAR(255) NOT NULL UNIQUE,
    [FirstName] NVARCHAR(60) NOT NULL,
    [LastName] NVARCHAR(60) NOT NULL
);
