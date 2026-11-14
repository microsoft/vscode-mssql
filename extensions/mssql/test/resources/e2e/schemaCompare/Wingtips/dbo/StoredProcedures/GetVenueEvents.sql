CREATE PROCEDURE [dbo].[GetVenueEvents]
    @VenueId INT
AS
    SELECT [EventId], [EventName], [Date]
    FROM [dbo].[Events]
    WHERE [VenueId] = @VenueId;
