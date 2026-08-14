CREATE TABLE t1(c1 xml(myCollection) not null)
GO
CREATE TABLE t1(c1 decimal(max));
GO
CREATE TABLE [dbo].[DatabaseDefinitions] (
	c6f decimal(max) not null,
	c7c numeric(max) not null,
	c17a char varying(max) not null,
	c39a Double Precision(max) not null,
	c47 [mytype](max),
	c48 dbo.mytype(max) not null,
	c51 xml([dbo].myCollection),
	c52 xml(content [dbo].myCollection) null,
	c53 xml(document [myCollection]) not null,	
	c55 "xml"(myCollection),
	c56 [XML]([dbo].myCollection),
	c57 [xMl](content [dbo].myCollection) null,
	c58 [XmL](document [myCollection]) not null);
GO
CREATE TABLE t1(
	c44 dbo.[mytype] not null,
	c45 dbo.mytype(10),
	c46 [dbo].mytype(10, 20) not null);
