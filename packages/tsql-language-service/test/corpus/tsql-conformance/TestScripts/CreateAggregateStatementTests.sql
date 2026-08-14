CREATE AGGREGATE Concatenate(@input nvarchar(4000))
RETURNS nvarchar(4000)
EXTERNAL NAME [StringUtilities].[Microsoft.Samples.SqlServer.Concatenate]

CREATE AGGREGATE dbo.a1(@input int) RETURNS int EXTERNAL NAME IntUtilities

CREATE AGGREGATE a1(@input xml(zzz)) RETURNS xml(zzz) EXTERNAL NAME ag1
