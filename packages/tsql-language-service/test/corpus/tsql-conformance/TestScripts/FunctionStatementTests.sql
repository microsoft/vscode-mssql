CREATE FUNCTION ISOweek (@DATE datetime)
RETURNS int
AS
BEGIN
   BREAK
END
GO

CREATE FUNCTION SalesByStore (@storeid varchar(30))
RETURNS TABLE WITH ENCRYPTION, SCHEMABINDING, called on null input
RETURN (SELECT title, qty
      FROM sales s, titles t
      WHERE s.stor_id = @storeid and
      t.title_id = s.title_id)
GO

CREATE FUNCTION fn_FindReports (@InEmpId nchar(5))
RETURNS @retFindReports TABLE (empid nchar(5) primary key,
   empname nvarchar(50) NOT NULL,
   mgrid nchar(5),
   title nvarchar(30))
/*Returns a result set that lists all the employees who report to given 
employee directly or indirectly.*/
AS
BEGIN
   BREAK
END
GO

CREATE FUNCTION SearchAuthorbyArticleID (@au_lname int) RETURNS TABLE 
AS RETURN (
	SELECT au_id from [dbo].[Authors] (nolock) as auth 
		WHERE auth.au_lname = @au_lname
)

GO
-- Some syntax is tested in CreateFunctionStatementTest.sql
alter function ISOweek(@p1 as int = 10)
returns int as
begin
break;
end

GO

-- several parameters
alter function SalesByStore (@storeid VARCHAR (30), @p2 as int)
RETURNS TABLE WITH SCHEMABINDING
AS
RETURN SELECT 
	title,
	qty
FROM
	sales AS s,
	titles AS t
WHERE
	s.stor_id = @storeid AND t.title_id = s.title_id

GO

CREATE FUNCTION fn_FindReports (@InEmpId nchar(5))
RETURNS @retFindReports TABLE (empid nchar(5) primary key,
   empname nvarchar(50) NOT NULL,
   mgrid nchar(5),
   title nvarchar(30))
WITH SCHEMABINDING
AS
BEGIN
   BREAK
END
GO

