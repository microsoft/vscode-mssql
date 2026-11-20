CREATE TABLE [dbo].[Events]
(
    [EventId] INT NOT NULL PRIMARY KEY,
    [VenueId] INT NOT NULL REFERENCES [dbo].[Venues] ([VenueId]),
    [EventName] NVARCHAR(128) NOT NULL,
    [Date] DATETIME2 NOT NULL
);
