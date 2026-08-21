-- sacaglar: Comments inline.

-- basic versions
create primary xml index c1 on t1(c1)
create primary xml index c1 on db..t1(c1)

-- secondary xml indexes
create xml index c1 on t1(c1) using xml index x2 for value
create xml index c1 on db..t1(c1) using xml index x2 for path
create xml index c1 on db..t1(c1) using xml index x2 for property

-- with options
create primary xml index c1 on t1(c1)
with (pad_index = on, fillfactor = 23, drop_existing = on, statistics_norecompute = off, 
      sort_in_tempdb = off, allow_row_locks = off, allow_page_locks = on, maxdop = 20, ignore_dup_key=off)

-- All together
create xml index c1 on t1(c1) using xml index [xml] for path with (drop_existing = on, fillfactor = 2)
create xml index c1 on t1(c1) using xml index x2 for value with (maxdop = 10)

