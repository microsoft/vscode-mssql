--sacaglar, comments inline

-- basic columns
declare @t1 Table (c1 int, c2 money, c3 varchar(20));

-- Unique, check and default constraints
declare @t1 table (c1 int unique nonclustered, check (c1 > 23), c3 int default 12)
