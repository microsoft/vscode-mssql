-- sacaglar: Comments inline

alter table t1 drop 
cs3, -- nonqualified first
column c2, c3, -- column and nonqualified
constraint cs1, cs2, -- constraint and nonqualified
column c4, c5; -- column and nonqualified again
