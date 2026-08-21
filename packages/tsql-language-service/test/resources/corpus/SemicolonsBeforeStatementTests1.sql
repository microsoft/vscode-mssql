-- There are more places where semicolons are not allowed in SQL 80 
-- see SemicolonsBeforeStatementsTest2.sql 
-- in batch
;;
create table t1(c1 int)
go

-- in begin/end block
create proc p1
as
begin
;;
return 0
end
go
