-- ALTER INDEX REORGANIZE WITH COMPRESS_ALL_ROW_GROUPS option
alter index ind1 on .db..t1 reorganize with(COMPRESS_ALL_ROW_GROUPS = on);
alter index ind1 on .db..t1 reorganize with(COMPRESS_ALL_ROW_GROUPS = off);
alter index ind1 on .db..t1 reorganize partition = 1 + 2 with(COMPRESS_ALL_ROW_GROUPS = on);
alter index ind1 on .db..t1 reorganize partition = 1 + 2 with(COMPRESS_ALL_ROW_GROUPS = off);
-- ALTER INDEX SET COMPRESSION_DELAY option
ALTER INDEX ind1 ON .db..t1 SET (COMPRESSION_DELAY = 0 MINUTE);
ALTER INDEX ind1 ON .db..t1 SET (COMPRESSION_DELAY = 27);
ALTER INDEX ind1 ON .db..t1 SET (COMPRESSION_DELAY = 10080 MINUTES);