CREATE VIEW [dbo].[VenueEvents]
AS
SELECT v.[VenueName], e.[EventName], e.[Date]
FROM [dbo].[Venues] AS v
INNER JOIN [dbo].[Events] AS e ON e.[VenueId] = v.[VenueId];
