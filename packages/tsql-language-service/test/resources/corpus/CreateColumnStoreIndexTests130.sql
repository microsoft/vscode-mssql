-- create nonclustered columnstore index with filter predicate
create nonclustered columnstore index NCCI
on T (A)
where A > 0

create nonclustered columnstore index NCCI
on T (A)
where A > 0
with (compression_delay = 42)

-- create clustered columnstore index with order hint
create clustered columnstore index CCI
on t
with (order(A))

create clustered columnstore index CCI
on t
with (sort_in_tempdb = on, order(A,B))
