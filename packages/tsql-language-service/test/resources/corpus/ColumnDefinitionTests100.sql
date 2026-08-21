
-- storage attributes
create table t1(
	c1 int sparse,
	c2 nchar(10) sparse,
	c3 xml sparse,
	c4 xml (SomeSchemaCollection) sparse,
	c6 varbinary(max) sparse,
	c7 varbinary(max) sparse filestream,
	c8 varbinary(max) filestream sparse)
GO

alter table t1 add c5 varbinary(max) filestream
GO
	
alter table t1 add c9 xml sparse
GO

alter table t1 add c10 xml column_set for all_sparse_columns
GO

-- Filestream is prohibited in table variables, table valued functions and table types
-- SPARSE is allowed for table variables, and prohibited in table valued function and table types
declare @v1 as table (c0 int sparse, c1 xml column_set for all_sparse_columns)