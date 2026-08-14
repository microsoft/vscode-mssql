dump certificate c1 to file = 'f1'
go

dump service master key to file = 'f1' encryption by password = 'pw1'
go

load service master key from file = 'f1' decryption by password = 'pw1'
go

LOAD MASTER KEY FROM FILE = 'f1' DECRYPTION BY PASSWORD = 'p1' ENCRYPTION BY PASSWORD = 'p2' FORCE
go