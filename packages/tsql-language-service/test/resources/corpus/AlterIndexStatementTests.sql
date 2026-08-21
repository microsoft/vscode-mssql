-- sacaglar: Comments inline.

-- Backwards compatible alter Index Statement
-- rebuild

alter index ind1 on .db..t1 Rebuild; 
alter index All on .db..t1 Rebuild with (pad_index = on)
alter index ind1 on .db..t1 Rebuild partition = 1 + 2 with (sort_in_tempdb = on, maxdop = 12)


-- reorganize
alter index ind1 on t1 Reorganize; 
alter index ind1 on .db..t1 Reorganize with (lob_compaction = on)
alter index ind1 on .db..t1 Reorganize partition = 1 + 2 with (lob_compaction = on)

-- all, disable
alter index all on t1 Disable; 

--set
alter index ind1 on t1 set (allow_page_locks = on)
alter index ind1 on t1 set (allow_row_locks = on, allow_page_locks = on, ignore_dup_key = off, statistics_norecompute = off)
