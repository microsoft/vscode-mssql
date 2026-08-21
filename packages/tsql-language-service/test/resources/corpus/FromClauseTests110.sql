select * from containstable(t1, property(c1, 'my_property'), 'foo', language 1033, 10) 
go

--Spatial window max cells query hint
SELECT TOP(5) *
FROM Restaurats r WITH(spatial_window_max_cells=512)
WHERE r.type = 'Italian' AND r.location.STDistance(@my_location) IS NOT NULL
ORDER BY r.location.STDistance(@my_location) 
go

--semantic rowset functions
select * from semantickeyphrasetable(t1, *) t_alias
go
select * from semantickeyphrasetable(remote1.db1.s1.t1, (*), 10) t_alias
go
select * from semantickeyphrasetable(db1.s1.t1, (c1, c2, c3), -10)
go
select * from semanticsimilaritytable(t1, c1, @v)
go
select * from semanticsimilaritytable(db1.s1.t1, (c1), 10) t_alias
go
select * from semanticsimilaritydetailstable(t1, c1, 10, c2, -100)
go
select * from semanticsimilaritydetailstable(db1.s1.t1, c1, 10, c2, @v) t_alias
go

