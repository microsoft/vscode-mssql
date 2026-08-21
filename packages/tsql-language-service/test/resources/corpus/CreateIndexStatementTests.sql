-- sacaglar: Comments inline.

-- Backwards compatible Create Index Statement
-- most basic
create index ind1 on t1 (c1); 

-- unique, asc
create unique index ind1 on t1 (c1 asc); 

-- unique, clustered, asc, desc, multiple columns
create unique clustered index ind1 on t1 (c1 asc, c2, c3 desc); 

-- nonclustered, multi-part name, fillfactor, multiple with options
create unique nonclustered index ind1 on tempdb.dbo.t1 (c1) with fillfactor = 23, PAD_INDEX;

-- nonclustered, multi-part name, fillfactor, multiple with options, filegroup
create unique nonclustered index ind1 on tempdb.dbo.t1 (c1) with fillfactor = 23, PAD_INDEX on [default] ;

GO

-- all the withoptions
create unique nonclustered index ind1 on tempdb.dbo.t1 (c1) 
with pad_index, fillfactor = 23, ignore_dup_key, drop_existing, statistics_norecompute, sort_in_tempdb

create index ind1 on t1 (c1) on myFileGroup; 
create index ind1 on t1 (c1) on 'myFileGroup'; 
