alter fulltext index on dbo.t1 enable
alter fulltext index on t1 disable

alter fulltext index on t1 set change_tracking manual
alter fulltext index on t1 set change_tracking auto
alter fulltext index on t1 set change_tracking = off

alter fulltext index on t1 add (c1, c2 type column int, c3 language 1043)
alter fulltext index on t1 add (c1, c2 type column int, c3 language 'THAI')
alter fulltext index on t1 add (c1) with no population

alter fulltext index on t1 drop (c1, c2) with no population
alter fulltext index on t1 drop (c1)

alter fulltext index on t1 start full population
alter fulltext index on t1 start incremental population
alter fulltext index on t1 start update population

alter fulltext index on t1 stop population

alter fulltext index on t1 pause population
alter fulltext index on t1 resume population
