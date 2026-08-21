create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c')

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS XQUERY MAXLENGTH(50))

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS XQUERY 'xs:string')

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS XQUERY 'xs:string' singleton)

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS XQUERY 'xs:string' MAXLENGTH(50))

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS XQUERY 'xs:string' MAXLENGTH(50) singleton)

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS XQUERY 'node()')

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS XQUERY 'node()' singleton)

create selective xml index sxi1 on t1(c1) for ( path1 = '/a/b/c',
												path3 = '/a/b/e' AS XQUERY 'xs:string' MAXLENGTH(50) singleton,
												path1 = '/a/b/f' AS XQUERY 'node()'
											  )

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS SQL NVARCHAR(50) )

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS SQL NVARCHAR(50) singleton)

create selective xml index sxi1 on t1(c1) for ( path1 = '/a/b/c',
												path3 = '/a/b/e' AS XQUERY 'xs:string' MAXLENGTH(50) singleton,
												path4 = '/a/b/f' AS XQUERY 'node()',
												path6 = '/a/b/n' AS SQL NVARCHAR(50),
												path5 = '/a/b/m' AS SQL NVARCHAR(50) singleton
											  )


create selective xml index sxi1 on t1(c1) 
with xmlnamespaces ( 'www.microsoft.com' as ns1,
                      'www.google.com' as ns2)
for (path1 = '/a/b/c')

create xml index sxisecondary on t1(c1)
using xml index sxi1 
for ( path1 )

create selective xml index sxi1 on t1(c1) for (path1 = '/a/b/c' AS SQL NVARCHAR(50) ) with (drop_existing = on, fillfactor = 2)
