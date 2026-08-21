--DISABLE_DEF_CNST_CHK
SET DISABLE_DEF_CNST_CHK on
go

--create trigger with append
create trigger trig1 on t1 for insert with append
as 
begin
print '1'
end
go

--fastfirstrow
Insert table1 with (FASTFIRSTROW, HOLDLOCK) (c2, c3) (select * from t1)
delete table1 with (fastfirstrow, HOLDLOCK)
select c1 from t1 as table1 with (INDEX (0,1,ind2), FASTFIRSTROW, HOLDLOCK, NOLOCK, PAGLOCK,
        READCOMMITTED, READPAST, READUNCOMMITTED, REPEATABLEREAD, ROWLOCK SERIALIZABLE 
        TABLOCK, TABLOCKX, UPDLOCK, XLOCK NOWAIT), t2 (index = ind1, fastfirstrow);
go

-- legacy raiserror
raiserror 25 'hello' 
raiserror 25 N'hello'
raiserror 25 @var1
raiserror -10 @var1
raiserror @firstVar @var1
go

--restore with dbo_only
restore database db1 from @var1 with dbo_only
go
--backup with password and with mediapassword
backup database d1 to disk = 'd:' with medianame = 'someMedia', mediapassword = 'PLACEHOLDER1', mediadescription = 'md1'
backup database d1 to disk = 'd:' with retaindays = 10, password = @pwdVar, format