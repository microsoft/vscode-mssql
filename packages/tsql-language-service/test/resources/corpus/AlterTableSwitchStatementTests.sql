-- sacaglar: Comments inline

-- Testing basic version
alter table t1 switch to t2
alter table t1 switch to db.dbo.t2

-- testing source partition expression
alter table t1 switch partition 2 + 3 to dbo.[t3]

-- testing target partition expression
alter table t1 switch to dbo.[t3] partition 3 

-- testing all together
alter table t1 switch partition -10 to dbo.[t3] partition +12 
