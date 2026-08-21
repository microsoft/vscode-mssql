-- create key from provider
create symmetric key k1 from provider p1
create symmetric key k1 from provider p1 with creation_disposition = CREATE_NEW
create symmetric key k1 from provider p1 with provider_key_name = 'key1', algorithm = rc4, CREATION_DISPOSITION = OPEN_EXISTING

create symmetric key k1 from provider p1 encryption by certificate c1

GO
-- drop key with remove provider
drop symmetric key k1 remove provider key
