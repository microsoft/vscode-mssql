create proc sp1 (@p1 int, @p2 int null = null, @p3 int not null)
as
begin
	declare @v1 int;
	declare @v2 int null;
	declare @v3 int not null = 4;
end