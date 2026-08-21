-- Basic call with only required arguments.
SELECT INVOKE_EXTERNAL_API('myFunctionSet', 'myFunction');
GO

-- With a single optional argument.
SELECT INVOKE_EXTERNAL_API('myFunctionSet', 'myFunction', 42);
GO

-- With multiple optional arguments of various expression kinds.
DECLARE @v INT = 7;
SELECT INVOKE_EXTERNAL_API(N'mySet', N'doStuff', @v, 'literal', 1 + 2, NULL);
GO

-- Inside an ALTER FUNCTION RETURN statement (critical RETURN-context coverage).
ALTER FUNCTION dbo.TestInvokeExternalApi()
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN (INVOKE_EXTERNAL_API('mySet', 'myFn', 'arg1'));
END;
GO

-- Inside a WHERE clause.
SELECT 1
FROM dbo.t
WHERE INVOKE_EXTERNAL_API('mySet', 'isAllowed', col1) = 1;
GO
