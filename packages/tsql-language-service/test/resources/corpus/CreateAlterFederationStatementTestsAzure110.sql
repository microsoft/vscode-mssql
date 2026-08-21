create federation f1 (k1 bigint range)
go

alter federation f1 split at (k1 = 10)
go

alter federation f1 drop at (low k1 = 20)
go

alter federation f1 drop at (high k1 = 20)
go
