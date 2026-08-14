-- sacaglar: Testing multiple GO's and a random create table script

GO

CREATE TABLE [dbo].[DatabaseDefinitions] (
	[DatabaseDefinitionId] [int] IDENTITY (1,1) NOT NULL,
	[Name] [varchar](50) COLLATE Latin1_General_CI_AS NOT NULL,
	[Description] [varchar](200) COLLATE Latin1_General_CI_AS NULL,
	[PhysicalName] decimal(50, 3) COLLATE Latin1_General_CI_AS NULL,
	[dt_inserted] [datetime] NOT NULL,
	[dt_updated] [datetime] NOT NULL)
ON [PRIMARY] ;

GO
GO