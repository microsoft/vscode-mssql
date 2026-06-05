-- ---------------------------------------------------------------------------
--  Creates the sample tSQLt test class. Runs against SmokeDb after tSQLt is
--  installed. tSQLt.NewTestClass creates a schema that tSQLt.RunAll scans for
--  test procedures.
-- ---------------------------------------------------------------------------
EXEC tSQLt.NewTestClass 'testSampleClass';
GO
