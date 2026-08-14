create table t1 (	
	-- Column level tests
	a9 int CONSTRAINT C3 UNIQUE Clustered ON partScheme(col))
GO

-- unique constraint with index option
create table t2 (	
	a10 int CONSTRAINT C4 UNIQUE WITH (pad_index = on, FILLFACTOR = 34, ignore_dup_key = off, 
									   statistics_norecompute = on, allow_row_locks = on, allow_page_locks = off)
)
GO

create table t2(
	c1 int,
	-- Table level tests
	CONSTRAINT C19 UNIQUE Clustered (a1 asc, a2 desc) WITH FILLFACTOR = 34 ON MyGroup(c2),
	CONSTRAINT C20 UNIQUE (a1 asc, a2 desc, a3) WITH (FILLFACTOR = 34, pad_index = on) ON [MyGroup],
)
;

