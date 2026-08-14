alter table t1 alter column c1 add hidden;

alter table t1 alter column c1 drop hidden;

alter table t1 alter column c1 int hidden null;

alter table t1 alter column c1 int hidden not null;

alter table t1 alter column c1 varchar(max) hidden not null;

alter table t1 alter column c1 varchar(100) COLLATE Traditional_Spanish_ci_ai hidden null;

alter table t1 alter column c1 int sparse hidden null;

alter table t1 alter column c1 varchar(100) COLLATE Traditional_Spanish_ci_ai sparse hidden null;

alter table t1 alter column c1 varbinary(max) COLLATE Traditional_Spanish_ci_ai filestream hidden null;

alter table t1 alter column c1 varbinary(max) filestream sparse hidden not null;

alter table t1 alter column c1 varbinary(max) sparse filestream hidden not null;

alter table t1 alter column c1 xml column_set for all_sparse_columns hidden null;

alter table t1 alter column c1 nvarchar(60) COLLATE  Latin1_General_BIN2
    encrypted with (COLUMN_ENCRYPTION_KEY = key1, ENCRYPTION_TYPE = RANDOMIZED, ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256') hidden;

alter table t1 alter column c1 nvarchar(32) masked with (function = 'default()') hidden not null;