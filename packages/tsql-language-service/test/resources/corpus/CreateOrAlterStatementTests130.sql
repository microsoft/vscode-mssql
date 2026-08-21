/*-----------------------------------------*/
/*        Create or alter function         */
/*-----------------------------------------*/
create function func_test() returns int as begin return(0); end
go

create or alter function func_test() returns int as begin return(0); end
go

/*-----------------------------------------*/
/*        Create or alter procedure        */
/*-----------------------------------------*/
create procedure sp_test as begin return(0); end
go

create or alter procedure sp_test as begin return(0); end
go

/*-----------------------------------------*/
/*         Create or trigger trigger          */
/*-----------------------------------------*/
create trigger trg_test on testTable for insert as select sum(col1 + col2) from inserted;
go

create or alter trigger trg_test on testTable for insert as select sum(col1 + col2) from inserted;
go

/*-----------------------------------------*/
/*          Create or alter view           */
/*-----------------------------------------*/
create view view_test as select col1 from testTable
go

create or alter view view_test as select col1 from testTable;