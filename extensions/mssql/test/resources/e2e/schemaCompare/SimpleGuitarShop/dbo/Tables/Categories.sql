CREATE TABLE [dbo].[Categories]
(
    [CategoryID] INT NOT NULL IDENTITY(1, 1) PRIMARY KEY,
    [CategoryName] NVARCHAR(255) NOT NULL UNIQUE
);
