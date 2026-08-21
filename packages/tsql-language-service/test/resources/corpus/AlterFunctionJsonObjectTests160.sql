-- Test ALTER FUNCTION with JSON_OBJECT containing subquery
ALTER FUNCTION FnName
    ()
RETURNS NVARCHAR(MAX)
AS
    BEGIN
        RETURN (JSON_OBJECT('Authorization' : 'Bearer ' + (SELECT Value1
                                                                  FROM   dbo.table1
                                                                  WHERE  field1 = 'Token')));
    END;
GO
