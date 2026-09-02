-- sacaglar: Comments inline

alter table t1 enable trigger all; -- enable, all

alter table t1 disable trigger all; -- disable, all

alter table t1 enable trigger trig1; -- enable, one trigger

alter table t1 disable trigger trig1, trig2; -- disable, multiple triggers