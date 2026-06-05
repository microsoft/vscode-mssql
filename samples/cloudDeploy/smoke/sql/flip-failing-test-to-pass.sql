-- ---------------------------------------------------------------------------
--  Part 23 (run comparison status-changed highlight) helper.
--  Flips [testSampleClass].[test failing case] to PASS, so a second
--  smoke-container run reports UnitTests = Passed while the first reported
--  Failed -> the compare view renders a status-changed (Failed -> Passed) row.
--
--  Run against SmokeDb, e.g.:
--    docker exec cloud-deploy-smoke-mssql /opt/mssql-tools18/bin/sqlcmd ^
--      -S localhost -U sa -P "Smoke_Pass_w0rd!" -C -d SmokeDb ^
--      -i /tmp/flip-failing-test-to-pass.sql
--  (or copy the statement into any SmokeDb query window).
--  Use restore-failing-test.sql to put it back afterwards.
-- ---------------------------------------------------------------------------
ALTER PROCEDURE [testSampleClass].[test failing case]
AS
BEGIN
    -- Temporarily made to PASS for the Part 23 comparison.
    EXEC tSQLt.AssertEquals 1, 1;
END;
GO
