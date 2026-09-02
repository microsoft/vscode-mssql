-- CLR table-valued function order hints
CREATE FUNCTION MyFunc() RETURNS TABLE (c1 int) ORDER (c1 ASC) AS EXTERNAL NAME a2.c2.f2;
GO
CREATE FUNCTION MyFunc() RETURNS TABLE (c1 int) ORDER (c1, c2 DESC, c3 ASC) AS EXTERNAL NAME a2.c2.f2;
GO
CREATE FUNCTION [dbo].[TableFunction2](@param1 int, @param2 nchar(5)) RETURNS TABLE
(
    c1 int, 
    c2 nchar(5),
    c3 datetime
)
WITH EXECUTE AS 'User1'
ORDER(c3 DESC, c1 ASC)
AS EXTERNAL NAME CLR1.UserDefinedFunctions.TableFunction1
GO
