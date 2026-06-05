-- ---------------------------------------------------------------------------
--  Two tSQLt tests in testSampleClass: one passes, one fails on purpose so the
--  UnitTestsValidator surfaces a mixed result with a real tSQLt.TestResult row
--  (Result = 'Failure'). Runs against SmokeDb.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE [testSampleClass].[test passing case]
AS
BEGIN
    EXEC tSQLt.AssertEquals 1, 1;
END;
GO

CREATE PROCEDURE [testSampleClass].[test failing case]
AS
BEGIN
    -- DELIBERATE failure: exercises the validator's Failed path.
    EXEC tSQLt.AssertEquals 1, 2;
END;
GO
