select MyColumn.MyFunctionWhichReturnsSomething(param).MyOtherFunction() COLLATE SQL_Latin1_General_CP1_CI_AS;
go

select [MyColumn].MyFunctionWhichReturnsSomething(param).MyOtherFunction() COLLATE SQL_Latin1_General_CP1_CI_AS;
go

select a().b(param).c([column]) COLLATE SQL_Latin1_General_CP1_CI_AS;
go

select a() COLLATE SQL_Latin1_General_CP1_CI_AS;
go

select [a] COLLATE some_collation, [b] COLLATE some_other_collation AS ColumnA;
go

select func([a]).func([b]).func(1, 2, 3, g(4)) COLLATE some_collation AS  FunctionCalls, [b] COLLATE some_other_collation AS ColumnB WHERE g([a]) > 0;
go