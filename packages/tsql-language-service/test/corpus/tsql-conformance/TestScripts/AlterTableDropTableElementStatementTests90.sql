-- dropping constraints with options...
alter table t1 drop constraint cs1 with (online = off, move to myFilegroup), cs2 with (maxdop = 21);
go
alter table t1 drop column c1, constraint c21 with (online = on), cs1 with (move to 'default'(col1), online = off, maxdop = 21)
