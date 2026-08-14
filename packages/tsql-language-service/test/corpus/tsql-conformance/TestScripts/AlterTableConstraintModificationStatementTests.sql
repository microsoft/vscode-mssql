-- sacaglar: Comments inline

alter table t1 nocheck constraint all; -- nocheck, all

alter table t1 with nocheck check constraint all; -- with nocheck

alter table t1 with check check constraint all; -- with check

alter table t1 with check check constraint cs1, cs3; -- multiple constraints