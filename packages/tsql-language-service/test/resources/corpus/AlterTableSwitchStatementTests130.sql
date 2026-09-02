-- with truncate target option
ALTER TABLE t1 SWITCH TO t2 WITH (truncate_target = on)
ALTER TABLE t1 SWITCH TO t2 WITH (truncate_target = off)
