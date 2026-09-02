create asymmetric key k1 from provider p1 WITH algorithm = DES
create asymmetric key k1 from provider p1 WITH algorithm = rc2, provider_key_name = 'kn1', CREATION_DISPOSITION = CREATE_NEW
create asymmetric key k1 from provider p1 WITH algorithm = DES ENCRYPTION BY PASSWORD = 'PLACEHOLDER'

GO

drop asymmetric key k1 remove provider key

