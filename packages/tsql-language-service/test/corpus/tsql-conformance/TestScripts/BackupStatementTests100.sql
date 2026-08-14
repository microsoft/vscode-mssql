-- COMPRESSION/NO_COMPRESSION options, added in Sql 2008
backup database d1 to someDevice WITH COMPRESSION
GO

backup database d1 to @deviceName WITH STOP_ON_ERROR, NO_COMPRESSION
