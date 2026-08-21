drop index i1 on t1 with (online = on, move to fg1, filestream_on ab), i2 on t2 with (online = off, move to fg1 (c1));
drop index i1 on t1 with (online = on, move to fg1, filestream_on "ab"), i2 on t2 with (online = off, move to fg1 (c1), data_compression = page);
drop index i1 on t1 with (online = on, move to fg1, data_compression = row);
drop index i1 on t1 with (data_compression = row);
drop index i1 on t1 with (move to fg1, filestream_on ab);
go
