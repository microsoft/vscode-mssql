-- Tim intrinsic calls with literals
select trim('  TestString  ');
select trim('[]' from '[abcdefgh]');
go
-- Tim intrinsic calls with variable
declare @str varchar(10) = 'TestString';
declare @chars varchar(3) = 'Teg';
select trim(@str);
select trim(@chars from @str);
go
-- Tim intrinsic calls with column
select trim(*) from TestTable;
select trim(col1 from col2) from TestTable;
go
-- Tim intrinsic with Null and empty values
select trim(NULL);
select trim('');
go
select trim(NULL from '[abcdefgh]');
select trim('[]' from NULL);
select trim(NULL from NULL);
select trim('' from '[abcdefgh]');
select trim('[]' from '');
select trim('' from '');
go
-- Sanity check for existing functions
select ltrim('  TestString');
select substring('Test', 0, 2);
go
-- Two args trim with colate clause
select trim(ltrim(' Test') collate Latin1_General_100_BIN2 from N'TestString');