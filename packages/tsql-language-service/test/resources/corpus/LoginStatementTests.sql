create login l1 with password = 'p1'
create login l1 with password = 'p1' hashed, sid = 0x10, default_database = db1, check_expiration = on
create login l1 with password = 0x234 hashed, sid = 0x10, default_database = db1, check_expiration = on
create login l1 with password = 'p1' must_change hashed, default_language = l1, check_policy = off, credential = c1

create login [l1] from windows
create login [l1] from windows with default_database = db1, default_language = l1

create login l1 from certificate c1
create login l1 from certificate c1 with credential = cr1

create login l1 from asymmetric key k1
create login l1 from asymmetric key k1 with credential = cr1
GO

alter login l1 enable
alter login l1 disable

alter login l1 with password = 'PLACEHOLDER1'
alter login l1 with password = 'PLACEHOLDER1' old_password = 'PLACEHOLDER2'
alter login l1 with password = 'PLACEHOLDER1' must_change
alter login l1 with password = 'PLACEHOLDER1' unlock must_change
alter login l1 with password = 'PLACEHOLDER1' unlock

alter login l1 with password = N'PLACEHOLDER1' hashed

alter login l1 with password = 0x00012 hashed
alter login l1 with password = 0x012 old_password = 'PLACEHOLDER2'
alter login l1 with password = 'PLACEHOLDER1' unlock hashed must_change


alter login l1 with no credential, default_database = db1, default_language = l1
alter login l1 with name = l2, check_policy = on, check_expiration = off
alter login l1 with credential = cr1

GO
drop login l1
