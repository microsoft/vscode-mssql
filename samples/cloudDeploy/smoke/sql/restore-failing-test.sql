-- ---------------------------------------------------------------------------
--  Part 23 helper — restores [testSampleClass].[test failing case] to its
--  original DELIBERATELY-FAILING state (AssertEquals 1, 2) after the
--  status-changed comparison has been demonstrated.
-- ---------------------------------------------------------------------------
ALTER PROCEDURE [testSampleClass].[test failing case]
AS
BEGIN
    -- DELIBERATE failure: exercises the validator's Failed path.
    EXEC tSQLt.AssertEquals 1, 2;
END;
GO
