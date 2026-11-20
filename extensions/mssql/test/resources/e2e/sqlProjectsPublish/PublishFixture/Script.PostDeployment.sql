-- Records the SQLCMD variable values the database was published with.
INSERT INTO [dbo].[DeploymentInfo] ([EnvName], [OwnerName]) VALUES (N'$(EnvName)', N'$(OwnerName)');
