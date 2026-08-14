-- alter service
alter service s1 on queue dbo.q1
alter service s1 (add contract c1, drop contract c2, add contract c3)
ALTER SERVICE [//Adventure-Works.com/Expenses] (ADD CONTRACT [//Adventure-Works.com/Expenses/ExpenseProcessing])
GO
-- create service
create service s1 authorization zzz on queue q1
create service s1 on queue dbo.q1 (c1, c2)
create service s1 on queue q1 (c1)