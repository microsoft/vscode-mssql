-- Testing AT TIME ZONE calls in select section
select dtColX at time zone tziColX from T;
select datepart(hour, dtColX at time zone tziColX) from T;
select case tziColX when null then dtColX at time zone 'UTC' else dtColX at time zone tziColX end from T;
select cast('1212-12-12 12:12:12' as datetime2) at time zone @tziVarX;
select dtColX at time zone tziColX at time zone tziColY from T;
GO


-- Testing AT TIME ZONE calls in where section
select * from T where dtColX at time zone tzi1ColX at time zone tzi2ColX < @criticalTime;
select * from T where colX < 5 AND @criticalTime < dtColX at time zone tzi1ColX at time zone tzi2ColX OR colY > 2;
GO


-- Testing AT TIME ZONE calls in table declarations
declare @t table(colX int, colY datetimeoffset not null default @dtVarX at time zone @tziVarX at time zone @tziVarY);
declare @t table(colX int, colY as colX at time zone @tziVarX at time zone @tziVarY);
GO