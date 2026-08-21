--sacaglar, comments inline

-- name only
create schema [dev]
GO

-- authorization only
create schema authorization dev
GO

-- name and authorization only
create schema [newDbo] authorization [dev]
GO

-- single statement tests
create schema authorization dev
create table t1(c1 int)
GO
create schema authorization dev
Create View schema1.view1 AS SELECT * FROM schema1.table2
GO
create schema authorization dev
grant CREATE PROCEDURE to [guest]
GO

-- multiple statements
create schema authorization dev
create table t1(c1 int)
grant CREATE PROCEDURE to [guest]
Create View schema1.view1 AS SELECT * FROM schema1.table2
GO
