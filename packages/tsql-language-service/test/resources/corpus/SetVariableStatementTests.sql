--sacaglar, comments inline

-- basic expression, int literal
set @a = 45

-- basic expression, string literal
set @b = 'Hello';

--complex expression, variable literal
set @c = (@a + @c - 23) / @a

-- set cursor case. Note, that most of cursor definition is tested in Declare Cursor statement tests
SET @CursorVar = CURSOR SCROLL DYNAMIC
FOR
SELECT LastName, FirstName
FROM Northwind.dbo.Employees
WHERE LastName like 'B%'

SET @var1 = @var2
