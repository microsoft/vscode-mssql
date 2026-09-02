-- Simpler test without subquery
ALTER FUNCTION FnName()
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN JSON_OBJECT('key':'value');
END;
GO
