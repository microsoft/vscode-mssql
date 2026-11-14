CREATE TABLE [dbo].[DeploymentInfo]
(
    [Id] INT IDENTITY (1, 1) NOT NULL PRIMARY KEY,
    [EnvName] NVARCHAR (100) NOT NULL,
    [OwnerName] NVARCHAR (100) NOT NULL
);
