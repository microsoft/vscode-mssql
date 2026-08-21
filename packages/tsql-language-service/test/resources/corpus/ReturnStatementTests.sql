-- return statement tests

CREATE PROCEDURE findjobs @nm sysname = NULL
AS 
IF @nm IS NULL
   BEGIN
      PRINT 'You must give a username'
      RETURN
   END
GO

CREATE PROCEDURE checkstate @param varchar(11)
AS
IF (SELECT state FROM authors WHERE au_id = @param) = 'CA'
   RETURN 1
ELSE
   RETURN 2
GO

CREATE FUNCTION ISOweek  (@DATE datetime)
RETURNS int
AS
BEGIN
   DECLARE @ISOweek int
   SET @ISOweek= DATEPART(wk,@DATE)+1
   RETURN(@ISOweek)
END

