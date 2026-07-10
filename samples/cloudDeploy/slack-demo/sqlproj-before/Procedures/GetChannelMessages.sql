CREATE PROCEDURE [dbo].[GetChannelMessages]
    @ChannelId INT,
    @Top       INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    -- Before the reactions feature: a simple, well-formed read of a channel's
    -- messages. Every reference resolves in the model, so build-time DacFx
    -- static analysis passes with zero findings.
    SELECT TOP (@Top)
        [m].[MessageId],
        [m].[UserId],
        [m].[Body],
        [m].[PostedAt]
    FROM [dbo].[Messages] AS [m]
    WHERE [m].[ChannelId] = @ChannelId
    ORDER BY [m].[PostedAt] DESC;
END;
GO
