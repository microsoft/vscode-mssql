-- Test ALTER FUNCTION with TRIM (which also uses semantic predicate)
ALTER FUNCTION TestTrim()
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN (TRIM(' test '));
END;
GO
