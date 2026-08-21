--sacaglar, comments inline
-- These might not execute on TSql server, because of missing constructs,
-- We are just testing the parser here.

-- simple expression
select a;

-- multiple expressions:
select
	-- star
	*,
	-- star with prefix
	[dbo].t1.*,
	-- expression with variable
	@a + 10,
	-- expression with Identitycol
	(IdentityCol * 10),
	-- Identity function
	Identity(int),
	-- Identity function with seed and increment
	Identity(tinyint, 10, 5),
	-- Identity function with signed seed and increment
	Identity(decimal(10,0), - 100, 5),
	-- column names, no AS
	c1 + 10 column1,
	c1 [column1],
	Identity(int) 'column1',
	c1 N'column1',
	-- column name with as
	c1 as column1,
	Identity(int) as 'column1',
	-- equals
	column1 = 10 + c1,
	[column1] = Identity(int),
	'column1' = c1,
	N'column1' = -c1 - 10,
	..t1.c1,
	master.dbo.t1.c1,
	..t1.*,
	master..t1.Identitycol,
	master..t1.Rowguidcol	
	;
	
-- select for variable setting
select @a = 10, @b = @a * 10 / 89;