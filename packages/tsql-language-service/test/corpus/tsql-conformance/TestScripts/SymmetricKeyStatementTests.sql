create symmetric key k1 authorization zzz with algorithm = des encryption by certificate c1
create symmetric key k1 with key_source = 'ks', identity_value = 'iv', algorithm = rc2 encryption by password = 'p1'
create symmetric key k1 with algorithm = rc4 
	encryption by certificate c1, password = 'p1', symmetric key s1, asymmetric key as1
GO	
alter symmetric key k1 drop encryption by password = 'p1'
alter symmetric key k1 add encryption by password = 'p1', symmetric key s1
GO
drop symmetric key k1

