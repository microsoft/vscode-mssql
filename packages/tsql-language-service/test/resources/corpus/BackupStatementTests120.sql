-- Backup database with ENCRYPTION option
backup database d1 to disk = 'd:' with format, compression, encryption(algorithm = AES_128, server certificate = cert1), stats = 10;
backup database d1 to disk = 'd:' with format, compression, encryption(algorithm = AES_192, server certificate = [cert1]), stats = 10;
backup database d1 to disk = 'd:' with format, compression, encryption(algorithm = AES_256, server asymmetric key = key1), stats = 10;
backup database d1 to disk = 'd:' with format, compression, encryption(algorithm = TRIPLE_DES_3KEY, server asymmetric key = [key1]), stats = 10;

-- Backup transaction log with ENCRYPTION option
backup log d1 to disk = 'd:' with format, compression, encryption(algorithm = AES_128, server asymmetric key = key1), stats = 10;
backup log d1 to disk = 'd:' with format, compression, encryption(algorithm = AES_192, server asymmetric key = [key1]), stats = 10;
backup log d1 to disk = 'd:' with format, compression, encryption(algorithm = AES_256, server certificate = cert1), stats = 10;
backup log d1 to disk = 'd:' with format, compression, encryption(algorithm = TRIPLE_DES_3KEY, server certificate = [cert1]), stats = 10;
