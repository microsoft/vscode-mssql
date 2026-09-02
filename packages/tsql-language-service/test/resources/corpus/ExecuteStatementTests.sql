--> Examples from Books Online
EXECUTE @returnstatus = dbo.ufnGetSalesOrderStatusText @Status = 2;

EXEC dbo.ProcTestDefaults;1 DEFAULT, 'I', @p3 = DEFAULT;

EXEC dbo.Proc_Test_Defaults @p2 = @p10 OUTPUT WITH RECOMPILE;

EXEC ('ALTER INDEX ALL ON ' + @schemaname + '.' + @tablename + ' REBUILD;');

-- testing global variables (VSTS 1065767)
EXECUTE ('SELECT ' + @@ERROR);

-- testing execution of model name variable
EXEC @varName

-- testing opendatasource
exec opendatasource('SQLNCLI', 
	'Data Source=London\Payroll;Integrated Security=SSPI').AdventureWorks.HumanResources.SomeProcedure
GO
-- check for simple execute (without EXEC keyword) at a batch beginning
sp_grantdbaccess 'redmond\eftqa1'
go

sp_grantdbaccess 'redmond\eftqa1'
select * from t1

-- execute with identifier as parameter
EXEC sp_addtype birthday, datetime, 'NULL'; 

-- test four part name
exec a.b.c.d