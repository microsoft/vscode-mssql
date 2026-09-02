EXEC ('SELECT ProductID, Name 
    FROM AdventureWorks.Production.Product
    WHERE ProductID = ? ', 952) AS USER = 'User1' AT SeattleSales;

go
-- testing login & pass-through
exec ('select') as login

-- testing pass-through with additional values
exec ('select' + ' * from t1', 5, @a) as login

