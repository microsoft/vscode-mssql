CREATE PROCEDURE [dbo].[GetCustomers]
AS
BEGIN
    -- CLEAN: every column and table reference resolves against the project
    -- model, so the build-time DacFx static analysis emits zero diagnostics
    -- and the StaticAnalysisValidator reports Passed. This is the
    -- counterpart to ../sqlproj/Procedures/GetCustomers.sql (the Failed
    -- fixture). Keep it clean — it is the point of this fixture.
    SELECT [Id], [Name]
    FROM [dbo].[Customers];
END;
GO
