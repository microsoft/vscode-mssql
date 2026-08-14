-- sacaglar: Comments inline
-- This might not work on Sql server, I need a place to test the
-- Column, later when I have test, column can be moved there.

CREATE TABLE A_Schema.A_TABLE (	
	A0 varchar(10), 
	A1 int DEFAULT + 23 identity(5, 10), -- Test plus
	A2 int identity(1, 3) NOT FOR REPLICATION DEFAULT -10, -- test minus
	A3 int default ~23, -- test tilde
	A4 int default [dbo].t1.c1, -- three part column test
	A5 int default t2.c2, -- two part column test
	A6 int default c2, -- one part column test
	A7 int default IdentityCol, -- IdentityCol test
	A8 int default RowguidCol, -- RowguidCol test
	A9 int default t1.IdentityCol, -- two part IdentityCol test
	A10 int default dbo.t2.RowguidCol, -- three part RowguidCol test	
	A11 int default +-++~+23, -- test multiple unary operators back to back
	A12 int default (+-++~+23), -- test paranthesis
	A13 int default (234), -- test paranthesis
	A14 int default ([dbo].t1.c1), -- test paranthesis
	A15 int default c1 + c2 - c3 & 10 | 20 ^ c4 * 12 / c1 % 40, -- All of the binary operators
	A16 int default c1 + c2 + c3 + ( 12 * 34 ) - ( 344 + ( 23 ^ 23) / 23 ) + - 23 % -23, -- mix and match
	A17 int default $Rowguid, -- PseudoCol Rowguid test	
	A18 int default $identity, -- PseudoCol identity test	
	A19 int default dbo.t2.$Rowguid, -- three part PseudoCol Rowguid test	
	A20 int default dbo.t2.$identity, -- three part PseudoCol identity test	
)
;
--test large literal
select 42949672960

-- test nullif
select nullif(@a, 0);

-- test coalesce
select coalesce(@a, 1);
select coalesce(@a, @b, 2 + 4);

-- test case, single expression
select case @a when @b + 10 then 20 end;

-- test case, single expression with collate
select case @a when @b + 10 then 20 end collate SQL_Latin1_General_CP1_CI_AS;

-- test case, multiple expressions
select case @a + @e when @b + 10 then 20 when @b + 20 then 30 when @c then 40 end;

-- test case, with else
select case @a when @b + 10 then 20 when @c then 40 else 0 end;

-- test case, boolean expression
select case when @b < 10 then 20 when @b > 20 then 30 end;
select case when @b > 10 and @c = 1 then 20 else 30 end;
select case when 1 is null then 1 else 0 end

-- test cast call
select cast(12 as float)
SELECT CAST(CAST(@myval AS varbinary(20)) AS decimal(10,5))
select cast(12 as float) collate SQL_Latin1_General_CP1_CI_AS

-- test convert call
select convert(float, 12)
select convert(float, 12) collate SQL_Latin1_General_CP1_CI_AS
SELECT CONVERT(decimal(10,5), CONVERT(varbinary(20), @myval))
select convert(datetime, @date, 101)

-- test parameterless calls
select user, current_user, session_user, system_user, current_timestamp, current_date
select user collate SQL_Latin1_General_CP1_CI_AS, current_user

-- test UniqueRowFilterCall
select count(all c1), count (distinct c1) from t1
-- with multiple names
select t1.count(all c1), [t2].count (distinct c1) from t1

-- test built in function call
select getdate(), avg(c1), left('Team System', 4), right('Team System', 6), count(*) from t1
select getdate(), avg(c1) collate SQL_Latin1_General_CP1_CI_AS

-- test user defined function call
select [master].[dbo].f1(1, 2), dbo.f1(1, 2)
select [master].[dbo].f1(1, 2) collate SQL_Latin1_General_CP1_CI_AS, dbo.f1(1, 2)

-- test column
select identitycol, rowguidcol, a.identitycol, a.b.rowguidcol, a collate SQL_Latin1_General_CP1_CI_AS, a.b, a.b.c

-- test subquery
select (((select * from t1) union select * from t2) union select * from t3)
select (select * from t1) collate SQL_Latin1_General_CP1_CI_AS

--test the odbc function calls
select {fn convert (@a, sql_int)}, {fn database()}
select {fn insert (@a, 12)}
select {fn left(@a, @b)}
select {fn right(@a, @b)}
select {fn truncate(10 + 12, @b)}
select {fn user()}
select {fn current_date()}
select {fn current_time}
select {fn current_time()}
select {fn current_time(@a)}
select {fn current_timestamp}
select {fn current_timestamp()}
select {fn current_timestamp(@a)}
select {fn BuiltinFunc1()}
select {fn BuiltinFunc1(@a, 12 + 23, {fn user()} )}
select {fn extract(hour from getdate())}

-- select odbc date time
select {t '1'}, {t N'1'}, {d '1'}, {d N'1'}, {ts '1'}, {ts N'1'}

-- paranthesis
Update [dbo].[Table1] 
    SET column_1 = ((select count(*) from [dbo].[Table2]) * 10)

GO

-- DevDiv# 137385 
CREATE TABLE [dbo].[Table2]
(
	[EmployerNumber] [varchar] (6) NOT NULL,
	[EmployeeNumber] [varchar] (9) NOT NULL,
	[EmployeeId] AS 
	(

	('S'+ right([EmployeeNumber],(4)))+ right(rtrim([EmployerNumber]),(1))

	) 

)

-- Make sure "fake comments" aren't created when two consecutive unary '-' are reparsed
select - - 1 from t
