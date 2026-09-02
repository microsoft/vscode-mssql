-- Hash index defined on column level (without column list)
create table T ( 
i int not null INDEX ix_i HASH WITH(BUCKET_COUNT= 10000)
, k int not null
)
with (memory_optimized = on, durability = schema_only);
go

create type TT as table(
 i int not null  INDEX ix_i NONCLUSTERED HASH WITH(BUCKET_COUNT= 10000)
, k int not null
)
with (memory_optimized = on);
go

-- Hash index defined on column level (with column list)
create table T ( 
i int not null INDEX ix_i HASH (i, k) WITH(BUCKET_COUNT= 10000)
, k int not null
)
with (memory_optimized = off, durability = schema_only);
go

create type TT as table(
 i int not null  INDEX ix_i
, k int not null
)
with (memory_optimized = on);
go

-- Index options defined on column level
create table t(
c int
index idx
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

-- Column nullability can be specified either before or after inline indexes
CREATE TABLE T
(
    [A1] [int] INDEX IX1 CLUSTERED NULL,
    [A2] [int] INDEX IX2 CLUSTERED NOT NULL
)

GO