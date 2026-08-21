-- ALTER DATABASE tests
-- Filestream
ALTER DATABASE db1 ADD FILEGROUP fg1 CONTAINS FILESTREAM
GO

-- CREATE DATABASE tests
-- Filestream
CREATE DATABASE db1
ON PRIMARY 
    (NAME = z1,FILENAME = 'qqq' ),
FILEGROUP FileStreamPhotos CONTAINS FILESTREAM DEFAULT
    (NAME = FSPhotos, FILENAME = 'aaa'),
FILEGROUP FileStreamResumes2 CONTAINS FILESTREAM
    (NAME = FileStreamResumes2, FILENAME = 'ddd')

--create database with clause
CREATE DATABASE MyOptionsTest
COLLATE French_CI_AI
WITH TRUSTWORTHY ON, DB_CHAINING ON;

CREATE DATABASE AdventureWorks ON 
    (FILENAME = 'c:\Program Files\Microsoft SQL Server\MSSQL10.MSSQLSERVER\MSSQL\Data\AdventureWorks_Data.mdf'), 
    (FILENAME = 'c:\Program Files\Microsoft SQL Server\MSSQL10.MSSQLSERVER\MSSQL\Data\AdventureWorks_log.ldf')
FOR ATTACH WITH ENABLE_BROKER