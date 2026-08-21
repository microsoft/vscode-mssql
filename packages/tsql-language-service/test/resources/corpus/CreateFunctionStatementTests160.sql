-- Create function with Json data type.
CREATE FUNCTION [ParameterizedFunction] 
(
	@parameter_name1 [json]
) RETURNS json
AS
  BEGIN
    RETURN '[30]';
  END
GO

-- Create function with vector data type.
CREATE FUNCTION [ParameterizedVectorFunction] 
(
	@parameter_name1 vector(2)
) RETURNS vector(2)
AS
	BEGIN
		DECLARE @v1 vector(2);
		SET @v1 = CAST(N'[1,1]' AS vector(2));
		RETURN @v1;
	END
GO