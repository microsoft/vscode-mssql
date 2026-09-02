-- Basic create trigger, FOR type
create trigger trig1 on employees 
for insert
as
create table t1 (c1 int);
GO

-- optional owner names
create trigger dbo.trig1 on dbo.employees 
for insert
as
create table t1 (c1 int);
GO

-- with encryption
create trigger trig1 on dbo.employees with encryption
for insert
as
create table t1 (c1 int);
GO

-- After Type
create trigger trig1 on employees 
after insert
as
create table t1 (c1 int);
GO

-- Instead OF Type
create trigger trig1 on employees 
instead of insert
as
create table t1 (c1 int);
GO

-- two actions
create trigger trig1 on employees 
instead of insert, update
as
create table t1 (c1 int);
GO

-- three actions
create trigger trig1 on employees 
after delete, insert, update
as
create table t1 (c1 int);
GO

-- three actions, three statements
create trigger trig1 on employees 
after delete, insert, update
as
create table t1 (c1 int);
create table t2 (c1 int);
create table t3 (c1 int);
GO

-- Three part table name
CREATE TRIGGER reminder
ON  [Northwind].[Schema1].titles
FOR INSERT, UPDATE, DELETE 
AS 
CREATE TABLE t1 (Col1 int not null)
