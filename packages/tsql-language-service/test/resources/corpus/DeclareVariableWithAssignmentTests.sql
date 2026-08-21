-- single declaration
declare @another real = 1.2
GO
-- multiple declarations
declare @t1 int = -10+1, @t2 as varchar(12) = 'aaa',  
	@t3 as cursor = 'bbb';
	