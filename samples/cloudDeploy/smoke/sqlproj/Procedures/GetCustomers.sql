CREATE PROCEDURE [dbo].[GetCustomers]
AS
BEGIN
    -- DELIBERATE: references a table that does not exist in the model so the
    -- build-time DacFx static analysis emits SQL71502 (unresolved reference).
    -- This exercises the StaticAnalysisValidator Failed path with a real
    -- diagnostic. Do not "fix" this — it is the point of the fixture.
    SELECT *
    FROM [dbo].[NonExistentTable];
END;
GO
