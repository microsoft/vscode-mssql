-- Objects that the Language Service scripting tests right-click in Object Explorer.
CREATE TABLE dbo.LsTable (
    Id INT NOT NULL PRIMARY KEY,
    Name NVARCHAR(50) NULL
);
GO
CREATE VIEW dbo.LsView AS
SELECT Id, Name FROM dbo.LsTable;
GO
CREATE PROCEDURE dbo.LsProcedure
    @Id INT
AS
BEGIN
    SELECT Id, Name FROM dbo.LsTable WHERE Id = @Id;
END
GO
CREATE SCHEMA LsSchema;
GO
CREATE USER LsUser WITHOUT LOGIN;
GO
