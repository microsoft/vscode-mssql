--Next Value For
SELECT NEXT VALUE FOR seq1
SELECT NEXT VALUE FOR seq1, NEXT VALUE FOR sequence.seq1
SELECT NEXT VALUE FOR Sequence1 OVER (ORDER BY OrderDate DESC)
SELECT NEXT VALUE FOR Sequence1 OVER (ORDER BY OrderDate DESC), IDENTITY(int, 1,1) AS ID_Num FROM MyTable
SELECT NEXT VALUE FOR Sequence1 OVER (ORDER BY OrderDate DESC),NEXT VALUE FOR Sequence2 OVER (ORDER BY Customer ASC),NEXT VALUE FOR Sequence3,* FROM MyTable
go

--CONTAINS with PROPERTY
select * from t1 where contains(property(c1, 'my_property'), 'foo')
go

--test try_convert function call 
select try_convert(int, '12345');
select try_convert(decimal(10,5), try_convert(varbinary(20), @myval));

--test try_cast function call 
select try_cast('12345' as int);
select try_cast(@myval as decimal(10,5));

--test iif function call
select iif(3>4, 'A', 'B');

--test parse function call
select parse('12345.54' as float using 'en-US');
select parse('12345.98' as float);

--test try_parse function call
select try_parse('12345.54' as float using 'en-US');
select try_parse('12345.98' as float);

