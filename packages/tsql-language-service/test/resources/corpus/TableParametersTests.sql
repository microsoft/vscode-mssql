-- create table type
CREATE TYPE tableType1 AS TABLE (c1 int primary key)
GO
CREATE TYPE tableType2 AS TABLE (c1 int, c2 as c1 persisted, unique(c1, c2))
GO

-- passing parameter as readonly to proc/function
CREATE PROCEDURE P1(@p1 tableType1 READONLY)
AS
	SELECT * FROM @p1
GO

CREATE FUNCTION F1(@p1 tableType1 READONLY, @p2 tableType2 READONLY)
RETURNS int
AS
BEGIN
	RETURN 1
END