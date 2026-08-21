-- SNAPSHOT hint
SELECT * FROM MemoryOptimizedTable WITH(SNAPSHOT)

-- All hints (including SNAPSHOT)
select c1 from t1 as table1 with (INDEX (0,1,ind2), HOLDLOCK, NOLOCK, PAGLOCK,
        READCOMMITTED, READPAST, READUNCOMMITTED, REPEATABLEREAD, ROWLOCK SERIALIZABLE 
        SNAPSHOT, TABLOCK, TABLOCKX, UPDLOCK, XLOCK NOWAIT), t2 (nowait);

select * from T option ( table hint(T, SNAPSHOT ));