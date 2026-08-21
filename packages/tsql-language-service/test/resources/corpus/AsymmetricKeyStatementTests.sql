create asymmetric key k1 authorization a1 from file = 'zzz'
create asymmetric key k1 from executable file = 'yyy'
create asymmetric key k1 from assembly aaa encryption by password = 'p1'
GO
-- different encryption algorithms
create asymmetric key k1 with algorithm = rc2
create asymmetric key k1 with algorithm = rc4
create asymmetric key k1 with algorithm = rc4_128
create asymmetric key k1 with algorithm = des
create asymmetric key k1 with algorithm = triple_des
create asymmetric key k1 with algorithm = desx
create asymmetric key k1 with algorithm = aes_128
create asymmetric key k1 with algorithm = aes_192
create asymmetric key k1 with algorithm = aes_256
create asymmetric key k1 with algorithm = rsa_512
create asymmetric key k1 with algorithm = rsa_1024
create asymmetric key k1 with algorithm = rsa_2048
GO

-- ALTER ASYMMETRIC KEY tests
alter asymmetric key a1 remove private key
alter asymmetric key a1 remove attested option
alter asymmetric key a1 attested by 'zzz'
alter asymmetric key a1 with private key (encryption by password = 'pw1')
alter asymmetric key a1 with private key (decryption by password = 'pw1')
alter asymmetric key a1 with private key (decryption by password = 'pw1', encryption by password = 'pw2')
GO

drop asymmetric key k1

