CREATE FUNCTION [Reporting].[FormatVenueName] (@VenueName NVARCHAR(128))
RETURNS NVARCHAR(140)
AS
BEGIN
    RETURN N'Venue: ' + @VenueName;
END;
