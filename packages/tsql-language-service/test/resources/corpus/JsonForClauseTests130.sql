-- For Json tests
select * from t1 for json auto
go
select * from t1 for json path
go
select * from t1 for json auto, root
go
select * from t1 for json path, root
go
select * from t1 for json auto, root('r1')
go
select * from t1 for json path, root('r1')
go
select * from t1 for json auto, include_null_values
go
select * from t1 for json path, include_null_values
go
select * from t1 for json auto, include_null_values, root
go
select * from t1 for json path, root, include_null_values
go
select * from t1 for json auto, root('r1'), include_null_values
go
select * from t1 for json path, include_null_values, root('r1')
go
select * from t1 for json auto, without_array_wrapper
go
select 1 as a for json path, include_null_values, without_array_wrapper
go