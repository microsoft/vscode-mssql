CREATE AGGREGATE [dbo].[Concatenate](@value NVARCHAR (MAX) NULL)
    RETURNS NVARCHAR (MAX)
    EXTERNAL NAME [AW2014_Sterling].[Concatenate];


GO
CREATE AGGREGATE [dbo].[Concatenate](@value NVARCHAR (MAX))
    RETURNS NVARCHAR (MAX)
    EXTERNAL NAME [AW2014_Sterling].[Concatenate];


GO
CREATE AGGREGATE [dbo].[Concatenate](@value NVARCHAR (MAX) NOT NULL)
    RETURNS NVARCHAR (MAX)
    EXTERNAL NAME [AW2014_Sterling].[Concatenate];
