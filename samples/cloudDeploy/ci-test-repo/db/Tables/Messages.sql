CREATE TABLE [dbo].[Messages]
(
    [MessageId] INT            NOT NULL PRIMARY KEY,
    [ChannelId] INT            NOT NULL,
    [Body]      NVARCHAR (400) NOT NULL,
    [PostedAt]  DATETIME2      NOT NULL
);
GO
