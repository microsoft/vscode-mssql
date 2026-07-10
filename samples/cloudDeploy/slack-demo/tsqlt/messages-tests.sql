/*
    Sample tSQLt test class for the Slack demo schema (Cloud Deploy Scope 2).

    These tests are appended to the per-run seed script and registered inside
    the freshly-provisioned ephemeral database after tSQLt itself is installed.
    `EXEC tSQLt.RunAll` (issued by the UnitTestsValidator) then runs them and
    writes per-test outcomes to tSQLt.TestResult, which the validator reads.

    All three are expected to pass against the before-reactions schema.
*/
EXEC tSQLt.NewTestClass 'MessagesTests';
GO

CREATE PROCEDURE MessagesTests.[test Messages table exists]
AS
BEGIN
    EXEC tSQLt.AssertObjectExists @ObjectName = 'dbo.Messages';
END;
GO

CREATE PROCEDURE MessagesTests.[test GetChannelMessages procedure exists]
AS
BEGIN
    EXEC tSQLt.AssertObjectExists @ObjectName = 'dbo.GetChannelMessages';
END;
GO

CREATE PROCEDURE MessagesTests.[test GetChannelMessages returns only the requested channel]
AS
BEGIN
    -- Isolate dbo.Messages so the test fully controls its rows.
    EXEC tSQLt.FakeTable @TableName = 'dbo.Messages';

    INSERT INTO dbo.Messages (MessageId, ChannelId, UserId, Body, PostedAt)
    VALUES (1, 1, 10, N'hello in channel 1',  '2026-01-01T00:00:00'),
           (2, 1, 11, N'second in channel 1', '2026-01-02T00:00:00'),
           (3, 2, 12, N'channel 2 message',   '2026-01-03T00:00:00');

    CREATE TABLE #Actual
    (
        MessageId INT,
        UserId    INT,
        Body      NVARCHAR (400),
        PostedAt  DATETIME2
    );

    INSERT INTO #Actual
    EXEC dbo.GetChannelMessages @ChannelId = 1, @Top = 100;

    DECLARE @Count INT = (SELECT COUNT(*) FROM #Actual);
    EXEC tSQLt.AssertEquals
        @Expected = 2,
        @Actual = @Count,
        @Message = N'GetChannelMessages should return exactly the two channel-1 messages.';
END;
GO
