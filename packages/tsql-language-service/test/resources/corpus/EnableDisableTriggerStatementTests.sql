-- enable
enable trigger all on b.c.t1; 
GO
enable trigger a.b.c, d.e, f, a.b on t1; 
GO
enable trigger a on all server
GO
enable trigger a, b, c on database
GO

-- disable
disable trigger all on b.c.t1; 
GO
disable trigger a.b.c, d.e, f, a.b on t1; 
GO
disable trigger a on all server
GO
disable trigger a, b, c on database
GO
