-- sacaglar: Testing three statements in one batch

CREATE TABLE [dbo].[DatabaseDefinitions] (
	[DatabaseDefinitionId] [int] IDENTITY (1,1) NOT NULL)
ON [PRIMARY] ;

CREATE TABLE t2 (
	int [int], c2 text)
ON [default] textimage_on [default];

CREATE TABLE t3 (
	int [int], c2 text)
textimage_on [Secondary];
