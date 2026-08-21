CREATE FUNCTION ISOweek (@DATE datetime)
RETURNS int with execute as caller, returns null on null input
AS
BEGIN
   BREAK
END
GO

CREATE FUNCTION fn_FindReports (@InEmpId nchar(5))
RETURNS @retFindReports TABLE (empid nchar(5) primary key,
   empname nvarchar(50) NOT NULL,
   mgrid nchar(5),
   title nvarchar(30))
WITH SCHEMABINDING, execute as caller
AS
BEGIN
   BREAK
END
GO

CREATE FUNCTION f1()
RETURNS TABLE 
RETURN (WITH XMLNAMESPACES (DEFAULT 'u') SELECT c1 FROM t1)
GO

-- External functions
CREATE FUNCTION MyFunc() RETURNS int AS EXTERNAL NAME a1.c1.f1
go

CREATE FUNCTION MyFunc() RETURNS TABLE (c1 int) AS EXTERNAL NAME a2.c2.f2;
GO

CREATE FUNCTION [app].[Workflow_Definition_GetName] 
(
@workflowDefinition XML(app.WorkflowDefinitionSchemaCollection)
)
RETURNS nvarchar(100)
AS  
BEGIN
RETURN @workflowDefinition.value(
'declare namespace wd=">http://www.deloitte.com/perhar/WAF/WorkflowDefinition";
(/wd:Workflow/@name)[1]',
'nvarchar(100)');
END;
