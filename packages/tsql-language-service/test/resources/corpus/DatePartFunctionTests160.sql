-- Datepart functions with each supported arity.
SELECT DATEADD(day, 1, OrderDate) AS AddedDate,
    DATEDIFF(mm, StartDate, EndDate) AS MonthDifference,
    DATEDIFF_BIG(second, StartDate, EndDate) AS BigSecondDifference,
    DATENAME(month, OrderDate) AS MonthName,
    DATEPART(wk, OrderDate) AS WeekPart,
    DATE_BUCKET(WEEK, 2, OrderDate) AS WeekBucket,
    DATE_BUCKET(DAY, 7, OrderDate, OriginDate) AS OriginDayBucket,
    DATETRUNC(year, OrderDate) AS YearTruncation
FROM dbo.Orders;

-- Documented DATEPART datepart names and abbreviations should not round-trip as column references.
SELECT DATEPART(year, OrderDate) AS YearPart,
    DATEPART(yy, OrderDate) AS YearShortPart,
    DATEPART(yyyy, OrderDate) AS YearLongPart,
    DATEPART(quarter, OrderDate) AS QuarterPart,
    DATEPART(qq, OrderDate) AS QuarterShortPart,
    DATEPART(q, OrderDate) AS QuarterSinglePart,
    DATEPART(month, OrderDate) AS MonthPart,
    DATEPART(mm, OrderDate) AS MonthShortPart,
    DATEPART(m, OrderDate) AS MonthSinglePart,
    DATEPART(dayofyear, OrderDate) AS DayOfYearPart,
    DATEPART(dy, OrderDate) AS DayOfYearShortPart,
    DATEPART(y, OrderDate) AS DayOfYearSinglePart,
    DATEPART(day, OrderDate) AS DayPart,
    DATEPART(dd, OrderDate) AS DayShortPart,
    DATEPART(d, OrderDate) AS DaySinglePart,
    DATEPART(week, OrderDate) AS WeekPart,
    DATEPART(wk, OrderDate) AS WeekShortPart,
    DATEPART(ww, OrderDate) AS WeekAltPart,
    DATEPART(weekday, OrderDate) AS WeekdayPart,
    DATEPART(dw, OrderDate) AS WeekdayShortPart,
    DATEPART(w, OrderDate) AS WeekdaySinglePart,
    DATEPART(hour, OrderDate) AS HourPart,
    DATEPART(hh, OrderDate) AS HourShortPart,
    DATEPART(minute, OrderDate) AS MinutePart,
    DATEPART(mi, OrderDate) AS MinuteShortPart,
    DATEPART(n, OrderDate) AS MinuteSinglePart,
    DATEPART(second, OrderDate) AS SecondPart,
    DATEPART(ss, OrderDate) AS SecondShortPart,
    DATEPART(s, OrderDate) AS SecondSinglePart,
    DATEPART(millisecond, OrderDate) AS MillisecondPart,
    DATEPART(ms, OrderDate) AS MillisecondShortPart,
    DATEPART(microsecond, OrderDate) AS MicrosecondPart,
    DATEPART(mcs, OrderDate) AS MicrosecondShortPart,
    DATEPART(nanosecond, OrderDate) AS NanosecondPart,
    DATEPART(ns, OrderDate) AS NanosecondShortPart,
    DATEPART(tzoffset, OrderDate) AS TimeZoneOffsetPart,
    DATEPART(tz, OrderDate) AS TimeZoneOffsetShortPart,
    DATEPART(iso_week, OrderDate) AS IsoWeekPart,
    DATEPART(isowk, OrderDate) AS IsoWeekShortPart,
    DATEPART(isoww, OrderDate) AS IsoWeekAltPart
FROM dbo.Orders;

-- Non-datepart built-ins still parse and generate through the regular function path.
SELECT ABS(Amount) AS AbsoluteAmount,
    UPPER(CustomerName) AS UpperCustomerName
FROM dbo.Orders;
