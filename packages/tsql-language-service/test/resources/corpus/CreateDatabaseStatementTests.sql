-- simple
create database d1

-- with data & transaction log files
CREATE DATABASE Sales
ON 
( NAME = Sales_dat, FILENAME = 'C:\data', SIZE = 10, MAXSIZE = 50, FILEGROWTH = 5 )
LOG ON
( NAME = Sales_log, FILENAME = 'C:\log', SIZE = 5MB, MAXSIZE = 25MB, FILEGROWTH = 5MB )
    
-- with filegroups
CREATE DATABASE  Sales
ON PRIMARY
( NAME = SPri1_dat, FILENAME = 'C:\data1'),
( NAME = SPri2_dat, FILENAME = 'C:\data2', FILEGROWTH = 15% ),
FILEGROUP SalesGroup1
( NAME = SGrp1Fi1_dat, FILENAME = 'c:\data3', SIZE = 10 KB, MAXSIZE = 50 TB),
( NAME = SGrp1Fi2_dat, FILENAME = 'c:\data4', MAXSIZE = UNLIMITED),
FILEGROUP SalesGroup2
( NAME = SGrp2Fi1_dat, FILENAME = 'c:\data5')

-- collate
CREATE DATABASE Archive ON (FILENAME = 'zzz') COLLATE French_CI_AI FOR ATTACH

-- No collision with DATABASE SCOPED CREDENTIALS
CREATE DATABASE SCOPED

CREATE DATABASE [SCOPED CREDENTIAL]

CREATE DATABASE SCOPED ON (FILENAME = 'zzz') COLLATE French_CI_AI FOR ATTACH