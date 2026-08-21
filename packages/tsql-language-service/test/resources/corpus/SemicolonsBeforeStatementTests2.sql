-- There are more places where semicolons are not allowed in SQL 80 
-- See SemicolonsBeforeStatementsTest1.sql 

-- in procedure body
create proc p1
as
;;
return 0
go

-- in trigger statement body
CREATE TRIGGER trig1
on Employee
AFTER INSERT
AS 
;;
SELECT * FROM Employee 
go

-- in try/catch
begin try
;;
create table t1(c1 int)
end try
begin catch
;;
end catch
go

