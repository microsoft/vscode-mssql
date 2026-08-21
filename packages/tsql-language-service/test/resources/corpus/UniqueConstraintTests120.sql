-- Hash PK constraints
create table T ( i int not null PRIMARY KEY NONCLUSTERED HASH WITH(BUCKET_COUNT= 10000) )
with (memory_optimized = on);
GO
create type TT as table( i int not null,
PRIMARY KEY NONCLUSTERED HASH (i) WITH( BUCKET_COUNT = 1000))
with (memory_optimized = on);
GO
-- Unique Hash constraint
create table T ( i int not null unique NONCLUSTERED HASH WITH(BUCKET_COUNT= 10000) )
with (memory_optimized = on);
GO

-- Existing clustered/non clustered constraints
create table T ( i int not null unique clustered )
GO
create type TT as table( i int not null, PRIMARY KEY NONCLUSTERED (i))
go