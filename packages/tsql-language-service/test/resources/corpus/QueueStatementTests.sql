-- sacaglar, comments inline

-- Create queue statements
--basic
create queue dbo.q1

-- testing on
create queue [q1] on [filegroup]
create queue [q1] on 'filegroup'
create queue [q1] on fileGroup

-- testing Options
create queue db.dbo.q1 with status = off
create queue q1 with status = on, Activation(status = on, procedure_name = dbo..p1, max_queue_readers = 23, execute as self), retention = off

-- testing all together
create queue q1 with Activation (status = on, procedure_name = dbo..p1, max_queue_readers = 23, execute as owner), status = on, retention = off on filegroup

Go

-- Alter queue statements
alter queue dbo.q1 with activation(drop)
alter queue dbo.q1 with status = on, activation(drop)

go
ALTER QUEUE ExpenseQueue
WITH ACTIVATION (
PROCEDURE_NAME = dbo.qspProcessExpenseQueue ,
EXECUTE AS 'dbo')
