create table t_ncci_inline(
	c int,
	index ncci nonclustered columnstore(c)
)
go 

create table t_cci_inline(
	c int,
	index cci clustered columnstore
)
go

create table t_ncci_filtered(
	c int,
	index ncci nonclustered columnstore(c) where c > 1
)
go 

create table table1 (
	c int,
	index ncci nonclustered columnstore(c) with (compression_delay = 1)
)
go

create table table1 (
	c int,
	index ncci nonclustered columnstore(c) with (compression_delay = 1 minute)
)
go

create table table1 (
	c int,
	index ncci nonclustered columnstore(c) with (compression_delay = 10 minutes)
)
go

create table table1 (
	c int,
	index ncci clustered columnstore with (compression_delay = 1)
)
go

create table table1 (
	c int,
	index ncci clustered columnstore with (compression_delay = 1 minute)
)
go

create table table1 (
	c int,
	index cci clustered columnstore with (compression_delay = 10 minutes)
)
go

create table t_implicit_ncci_inline(
	c int,
	index ncci columnstore (c)
)
go 