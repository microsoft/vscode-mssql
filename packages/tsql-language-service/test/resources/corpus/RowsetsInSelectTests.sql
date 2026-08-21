	-- Select statement rowset tests
-- CONTAINSTABLE/FREETEXTTABLE table source
SELECT FT_TBL.Description, 
   FT_TBL.CategoryName, 
   KEY_TBL.RANK
FROM Categories AS FT_TBL INNER JOIN
   CONTAINSTABLE (Categories, *, 
      '("sweet and savory" NEAR sauces) OR
      ("sweet and savory" NEAR candies)'
      , 10
   ) ON FT_TBL.CategoryID = KEY_TBL.[KEY]

SELECT FT_TBL.CategoryName, 
   FT_TBL.Description,
   KEY_TBL.RANK
FROM Categories AS FT_TBL INNER JOIN
   FREETEXTTABLE(Categories, Description, 
   'sweetest candy bread and dry meat') AS KEY_TBL
   ON FT_TBL.CategoryID = KEY_TBL.[KEY]

-- OPENROWSET table source
SELECT a.*
FROM OPENROWSET('SQLOLEDB',N'seattle1';'manager';'MyPass',
   'SELECT * FROM pubs.dbo.authors ORDER BY au_lname, au_fname') AS a

SELECT a.*
FROM OPENROWSET('MSDASQL', 'DRIVER={SQL Server};SERVER=seattle1;UID=manager;PWD=PLACEHOLDER',
   [pubs].[dbo].[authors])

-- OPENQUERY table source
SELECT *
FROM OPENQUERY(OracleSvr, 'SELECT name, id FROM joe.titles') AS a

-- Ad hoc (OPENDATASOURCE) table source
SELECT * FROM OPENDATASOURCE('SQLOLEDB', 
	'Data Source=ServerName;User ID=MyUID;Password=PLACEHOLDER') . 'Something' AS Z

SELECT * FROM OpenDataSource('Microsoft.Jet.OLEDB.4.0',
  'Data Source="c:\Finance\account.xls";User ID=Admin;Password=;Extended properties=Excel 5.0')...xactions

-- OPENXML table source
SELECT * FROM OPENXML (@idoc, '/ROOT/Customer',1) 
	WITH (CustomerID  varchar(10) '../@CustomerID', ContactName varchar(20))
	
SELECT * FROM OPENXML (@idoc, '/ROOT/Customer/Order/OrderDetail') WITH t1

SELECT * FROM OPENXML (@idoc, '/ROOT/Customer/Order/OrderDetail') AS xxx

SELECT * INTO #TempEdge FROM OPENXML(@xmldoc, @xpath)

-- Using the Xpath text() function as column pattern
SELECT * FROM OPENXML (@idoc, '/root/Customer/Order', 1)
      WITH (oid   char(5), 
            amount  float, 
            comment ntext 'text()')
EXEC sp_xml_removedocument @idoc

-- internal OPENROWSET
SELECT * FROM OPENROWSET(something, @var1)

SELECT * FROM Categories AS FT_TBL INNER JOIN
   CONTAINSTABLE (Categories, (c1, c2), '("sweet and savory" NEAR sauces)' , 10, Language 10
   ) ON FT_TBL.CategoryID = KEY_TBL.[KEY]

SELECT * FROM Categories AS FT_TBL INNER JOIN
   CONTAINSTABLE (Categories, (*), '("sweet and savory" NEAR sauces)' , Language 10, 3
   ) ON FT_TBL.CategoryID = KEY_TBL.[KEY]

