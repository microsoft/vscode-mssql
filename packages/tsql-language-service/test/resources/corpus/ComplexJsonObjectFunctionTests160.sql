-- Test CREATE FUNCTION with complex JSON_OBJECT containing FOR JSON PATH subqueries
CREATE FUNCTION [dbo].[MyFunction]()
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            t1.Id,
            JSON_OBJECT(
                'Column1': t1.Column1,
                'Column2': 
                (
                    SELECT
                        t2.*
                    FROM table2 t2
                    WHERE t1.Id = t2.Table2Id
                    FOR JSON PATH
                )
            ) AS jsonObject
        FROM table1 t1
        FOR JSON PATH, INCLUDE_NULL_VALUES
    )
END;
GO