alter index sxi1 on t1 for (remove path1)

alter index sxi1 on t1 for (add path1 = '/a/b/c')

alter index sxi1 on t1 for (add path1 = '/a/b/c' AS XQUERY 'xs:string')

alter index sxi1 on t1 for (add path1 = '/a/b/c' AS XQUERY 'xs:string' singleton)

alter index sxi1 on t1 for ( add path1 = '/a/b/c' AS XQUERY 'xs:string' MAXLENGTH(50),
							 remove path2,
                             add path3 = '/a/b/f' AS XQUERY 'node()'
					       )

alter index sxi1 on t1
with xmlnamespaces ( 'www.microsoft.com' as ns1,
                      'www.google.com' as ns2)
for (remove path1,
	 remove path3,
     add path2 = '/a/b/c' AS XQUERY 'xs:string' MAXLENGTH(50),
	 add path7 = '/a/b/c' AS XQUERY 'xs:double'
	 )




