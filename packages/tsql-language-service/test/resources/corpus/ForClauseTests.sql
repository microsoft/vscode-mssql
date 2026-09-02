-- For clause tests
SELECT * FROM t1 FOR BROWSE
GO

SELECT * FROM t1 FOR XML AUTO, XMLDATA, ELEMENTS, BINARY BASE64
GO

SELECT * FROM t1 FOR XML EXPLICIT, ELEMENTS
GO

SELECT * FROM t1 FOR XML AUTO, BINARY BASE64, XMLDATA
GO

SELECT * FROM t1 FOR READ ONLY
GO

SELECT * FROM t1 FOR UPDATE
GO

SELECT * FROM t1 FOR UPDATE OF c1
GO

SELECT * FROM t1 FOR UPDATE OF c1, c2
GO

-- SQL 2005 additions
select * from t1 for xml path
go
select * from t1 for xml path ('n1')
go
select * from t1 for xml raw ('eln1')
go
select * from t1 for xml raw, xmlschema('tnsURI'), root('r1'), type
go
select * from t1 for xml raw, xmlschema, root, elements xsinil
go
select * from t1 for xml path, elements absent
go