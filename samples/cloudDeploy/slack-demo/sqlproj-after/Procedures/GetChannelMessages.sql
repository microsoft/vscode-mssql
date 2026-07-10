CREATE PROCEDURE [dbo].[GetChannelMessages]
    @ChannelId INT,
    @Top       INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    -- The reactions feature rewrite: the proc now counts reactions per message
    -- from [dbo].[Reactions]. DELIBERATE BUG: the developer added the join but
    -- forgot to add the Reactions table to the project (source control), so the
    -- reference is unresolved in the model. Build-time DacFx static analysis
    -- catches it as SQL71502 (unresolved reference) and fails the check — before
    -- the change ever ships. Do not "fix" this by adding the table; it is the
    -- point of the fixture.
    SELECT TOP (@Top)
        [m].[MessageId],
        [m].[UserId],
        [m].[Body],
        [m].[PostedAt],
        (SELECT COUNT(*) FROM [dbo].[Reactions] AS [r] WHERE [r].[MessageId] = [m].[MessageId])
            AS [ReactionCount]
    FROM [dbo].[Messages] AS [m]
    WHERE [m].[ChannelId] = @ChannelId
    ORDER BY [m].[PostedAt] DESC;
END;
GO
