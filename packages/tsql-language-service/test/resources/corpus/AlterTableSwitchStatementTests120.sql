-- with MLP low priority lock wait option
alter table t1 switch to t2 WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 0, ABORT_AFTER_WAIT = NONE))
alter table t1 switch partition 1 to t2 WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 1, ABORT_AFTER_WAIT = SELF))
alter table t1 switch partition 1 to t2 partition 1 WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 1, ABORT_AFTER_WAIT = BLOCKERS))
alter table t1 switch to t2 WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 1440 minutes, ABORT_AFTER_WAIT = NONE))
alter table t1 switch partition 1 to t2 WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 71582 minutes, ABORT_AFTER_WAIT = SELF))
alter table t1 switch partition 1 to t2 partition 1 WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 0 MINUTES, ABORT_AFTER_WAIT = BLOCKERS))
