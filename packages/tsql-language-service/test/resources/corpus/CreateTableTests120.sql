 -- Check T-SQL 120-specific column / table syntax

-- Memory optimized
CREATE TABLE t1 (
    c1 INT
)
WITH (MEMORY_OPTIMIZED = ON);

-- Durability
CREATE TABLE t1 (
    c1 INT
)
WITH (DURABILITY = SCHEMA_ONLY);

-- Memory optimized and durability
CREATE TABLE t1 (
    c1 INT
)
WITH (DURABILITY = SCHEMA_AND_DATA, MEMORY_OPTIMIZED = OFF)

-- Hash index defined on table level 
create table T ( 
i int not null
, k int not null
, INDEX ix_i NONCLUSTERED HASH  (i, k) WITH(BUCKET_COUNT= 10000)
)
with (memory_optimized = on, durability = schema_and_data);
go

create type TT as table(
 i int not null
, k int not null
, INDEX ix_i HASH (k, i) WITH(BUCKET_COUNT= 10000)
)
with (memory_optimized = off);
go

-- Clustered/nonclustered index defined on table level
create table T ( 
i int not null
, k int not null
, INDEX ix_i CLUSTERED (i, k)
)
with (memory_optimized = on, durability = schema_and_data);
go

create type TT as table(
 i int not null
, k int not null
, INDEX ix_i (k, i)
)
with (memory_optimized = off);
go

create table T ( 
i int not null
, k int not null
, INDEX ix_i NONCLUSTERED (i, k)
)
go

-- Index options defined on table level
create table t(
c int,
index idx (c)
	with(
		PAD_INDEX = ON
	  , FILLFACTOR = 1
	  , IGNORE_DUP_KEY = OFF
	  , STATISTICS_NORECOMPUTE = ON
	  , ALLOW_ROW_LOCKS = OFF
	  , ALLOW_PAGE_LOCKS = ON
	  , BUCKET_COUNT = 1000
	  , DATA_COMPRESSION = ROW ON PARTITIONS (1)
	  , DATA_COMPRESSION = PAGE ON PARTITIONS (2))
	on fg
	filestream_on fs_fg
)
go