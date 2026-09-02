-- 2005 Create index statement
-- testing include
create index ind1 on t1 (c1) include (c1); 
create index ind1 on t1 (c1) include (c1, c2); 
GO
-- all the with options
create unique nonclustered index ind1 on tempdb.dbo.t1 (c1) 
with (pad_index = on, fillfactor = 23, ignore_dup_key = off, drop_existing = on, statistics_norecompute = off, 
      sort_in_tempdb = off, online = off, allow_row_locks = off, allow_page_locks = on, maxdop = 50)
GO      
-- testing the filegroup
create index ind1 on t1 (c1) on [partitionScheme]([columnName]); 
create index ind1 on t1 (c1) on partitionScheme(c1,c2,c3);