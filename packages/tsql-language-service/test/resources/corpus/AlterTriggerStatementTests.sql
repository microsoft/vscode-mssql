-- sacaglar: Most of the functionality is tested at Create Trigger.
alter trigger trig1 on employees 
for insert
as
create table t1 (c1 int);

