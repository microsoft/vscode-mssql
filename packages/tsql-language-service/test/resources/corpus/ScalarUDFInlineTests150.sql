CREATE FUNCTION [dbo].[test_udf2]()
RETURNS int
WITH INLINE=ON
AS
begin declare @v int = 10; return @v*@v; end;
go
CREATE FUNCTION [dbo].[test_udf1]()
RETURNS int
WITH INLINE=OFF
AS
begin declare @v int = 10; return @v*@v; end;
go
ALTER FUNCTION [dbo].[test_udf1]()
RETURNS int
WITH INLINE=ON, ENCRYPTION
AS
begin declare @v int = 10; return @v*@v; end;
go
CREATE OR ALTER FUNCTION [dbo].[test_udf1]()
RETURNS int
WITH INLINE=ON
AS
begin declare @v int = 10; return @v*@v; end;