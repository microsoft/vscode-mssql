-- Simple statements introduced in T-Sql 90
--close symmetric key
close symmetric key key1
close all symmetric keys

--close master key
close master key

-- open master key
OPEN MASTER KEY DECRYPTION BY PASSWORD = 'password'
go
-- kill stats job
kill stats job 12
kill stats job -12
go
-- kill query notification subscription
kill query notification subscription 12
kill query notification subscription all
go
checkpoint 12

