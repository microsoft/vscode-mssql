select * from T order by a offset 5 rows fetch next 2 rows only
select * from T order by a offset 5 row fetch first 2 row only
select * from T order by a offset @p rows fetch next @r rows only
select * from T order by a offset (select count(*) from T2) rows fetch next (-1) rows only
select * from T order by a offset 5 rows fetch next (select count(*) from T2) rows only
select * from T order by a offset (5+2) rows fetch next 3*10 rows only
select * from T order by a offset 5 rows fetch next (@p+6) rows only
select * from T order by a offset (sum(5)) rows fetch next 6 rows only
select * from t1 cross apply (select * from sys.objects order by 1 offset offset rows fetch first first rows only) t1
insert into t select * from t order by c1 asc offset 1 rows fetch first 2 rows only