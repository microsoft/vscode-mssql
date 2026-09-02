-- Unique hash index defined on column level (without column list)
CREATE TABLE T(
    i int not null INDEX ix_i UNIQUE HASH WITH(BUCKET_COUNT= 10000),
    k int not null
)
with (memory_optimized = on, durability = schema_only);
go

-- Unique nonclustered index defined on column level (without column list) for table type
create type TT as table(
    i int not null INDEX ix_i UNIQUE NONCLUSTERED,
    k int not null
)
with (memory_optimized = on);
go

-- Unique nonclustered index defined on column level (with column list)
create table T(
    i int not null INDEX ix_i UNIQUE HASH (i, k) WITH(BUCKET_COUNT= 10000),
    k int not null
)
with (memory_optimized = off, durability = schema_only);
go

-- Unique nonclustered index defined on column level (with column list) for table type
create type TT as table(
    i int not null INDEX ix_i UNIQUE,
    k int not null
)
with (memory_optimized = on);
go

-- Unique hash index defined on table level
create table T(
    i int not null,
    k int not null,
    INDEX ix_i UNIQUE HASH (i, k) WITH(BUCKET_COUNT= 10000)
)
with (memory_optimized = off, durability = schema_only);
go

-- Add a unique hash index
ALTER TABLE t1
    ADD INDEX i1 UNIQUE NONCLUSTERED HASH (c1) WITH (BUCKET_COUNT = 256);

-- Add a unique nonclustered index
ALTER TABLE t1
    ADD INDEX i1 UNIQUE NONCLUSTERED (c1, c2);
