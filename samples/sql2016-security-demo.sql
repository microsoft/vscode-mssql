-- SaNagama, 2016
-- Simple Clinic DB demo presented at the Azure Cloud Roadshow in Bengaluru (Bangalore), India.

USE [master]
GO

-- Create the Clinic database
ALTER DATABASE [Clinic] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
GO
DROP DATABASE IF EXISTS [Clinic];
GO
CREATE DATABASE [Clinic];
GO
ALTER DATABASE [Clinic] SET COMPATIBILITY_LEVEL = 130;
GO

USE [Clinic];
GO

-- Create Patients table
CREATE TABLE [dbo].[Patients]
(
 [PatientId] [int] NOT NULL,
 [WardName] [nvarchar](50) NOT NULL,
 [PAN_Number] [char](9) NOT NULL,
 [FirstName] [nvarchar](50) NOT NULL,
 [LastName] [nvarchar](50) NOT NULL,
 [Email] [nvarchar](50) NOT NULL,
 [City] [nvarchar](50) NULL,
 [PostalCode] [nvarchar](10) NULL,
 [MobileNumber] [nvarchar](50) NOT NULL

 PRIMARY KEY CLUSTERED ([PatientId] ASC) ON [PRIMARY]
);
GO

-- Create Nurse -to- Ward mapping table
CREATE TABLE [dbo].[NurseToWardMap]
(
 [NurseName] sysname NOT NULL,
 [WardName] [nvarchar](50) NOT NULL
);
GO

-- Create a user for nurse 'Rakesh'
CREATE USER Rakesh WITHOUT LOGIN;
GRANT SELECT ON [Patients] TO Rakesh;
GO

-- Create a user for nurse 'Manorama'
CREATE USER Manorama WITHOUT LOGIN;
GRANT SELECT ON [Patients] TO Manorama;
GO

-- Assign nurses to Wards
-- Insert sample data into Nurse -to- Ward mapping table
INSERT INTO [dbo].[NurseToWardMap]( [NurseName], [WardName])
VALUES
('Rakesh', 'Geriatrics'),
('Rakesh', 'Psychiatric'),
('Manorama', 'Maternity'),
('Manorama', 'Pediatrics')
GO

-- Insert sample data into Patients table
INSERT INTO [dbo].[Patients]([PatientId],[WardName],[PAN_Number],[FirstName],[LastName],[Email],[City],[PostalCode],[MobileNumber])
VALUES
(1, 'Geriatrics', 'ABCD1234A', 'Amitabh', 'Bachchan', 'angry_young_man@gmail.com', 'Mumbai', '400049', '2620616212'),
(2, 'Psychiatric', 'PQRS2345B', 'Abhishek', 'Bachchan', 'abhishek@abhishekbachchan.org', 'Mumbai', '400053', '8890195228'),
(3, 'Maternity', 'ASDF3456C', 'Aishwarya', 'Rai', 'ash@gmail.com', 'Mumbai', '400053', '9991206339'),
(4, 'Pediatrics', 'QRTY4567D', 'Joe', 'Blogger', 'joe@blogger.org', 'Mumbai', '400053', '8988234567'),
(5, 'Pediatrics', 'DBFG7899E', 'Sally', 'Parker', 'sallyp@gmail.org', 'Pune', '422013', '8008123456'),
(6, 'Intensive Care', 'PQRS5678E', 'Kareena', 'Kapoor', 'bebo@kapoor.org', 'Mumbai', '400057', '8007891721')
GO

/*
 * 1. Row Level Security Demo
 *
 */

-- Dump Ward assignments
SELECT * FROM NurseToWardMap;
GO

-- Dump Patient records - note that all nurses can see all patient records!
SELECT * FROM Patients;
GO

-- Create security policy to filter out Patient records
CREATE SCHEMA Security;
GO

-- Simple predicate function that checks current user and ward information
CREATE FUNCTION Security.fn_securitypredicate(@WardName as [nvarchar](50))
	RETURNS TABLE WITH SCHEMABINDING
AS
	RETURN SELECT 1 AS [fn_securitypredicate_result] FROM
		[dbo].[NurseToWardMap] n WHERE n.NurseName = USER_NAME() AND n.WardName = @WardName;
GO

-- Apply filter predicate on 'Patients' table
CREATE SECURITY POLICY dbo.SecPol
ADD FILTER PREDICATE Security.fn_securitypredicate(WardName) ON [dbo].[Patients]
WITH (STATE = ON)

-- Dump Patient records again
-- The records are filtered now because Row Level Security helps you control access to rows in a table
-- based on the user executing a query
SELECT * FROM Patients;
GO

EXECUTE AS USER = 'Rakesh';
SELECT * FROM Patients;
REVERT;
GO

EXECUTE AS USER = 'Manorama';
SELECT * FROM Patients;
REVERT;
GO

-- You can turn off the filter predicate as follows
ALTER SECURITY POLICY dbo.SecPol
WITH (STATE = OFF);
GO

/*
 * 2. Data Masking Demo
 *
 */

EXECUTE AS USER = 'Manorama';
SELECT * FROM Patients;
REVERT;
GO

-- Apply mask: only show 1st and Last digits of PAN_Number
ALTER TABLE [Patients] ALTER COLUMN [PAN_Number] ADD MASKED WITH (FUNCTION = 'partial(1,"XXXXXXX",1)');
GO

-- Apply mask: mask e-mail with a built-in function
ALTER TABLE [Patients] ALTER COLUMN [Email] ADD MASKED WITH (FUNCTION = 'email()');
GO

-- Apply mask: only show first 2 digits of mobile number
ALTER TABLE [Patients] ALTER COLUMN [MobileNumber] ADD MASKED WITH (FUNCTION = 'partial(2, "XXXXXXXX", 0)');
GO

GRANT UNMASK to Rakesh;
GO

-- Dump Patient records as user 'Manorama' - the data is masked now - and no changes needed to client app!
EXECUTE AS USER = 'Manorama';
SELECT * FROM Patients;
REVERT;
GO

-- Dump Patient records as user 'Rakesh'- the data is unmasked now - and no changes needed to client app!
EXECUTE AS USER = 'Rakesh';
SELECT * FROM Patients;
REVERT;
GO

-- Drop the data masks
ALTER TABLE [Patients] ALTER COLUMN [PAN_Number] DROP MASKED;
ALTER TABLE [Patients] ALTER COLUMN [Email] DROP MASKED;
ALTER TABLE [Patients] ALTER COLUMN [MobileNumber] DROP MASKED;

-- Turn off RLS and filter predicate
ALTER SECURITY POLICY dbo.SecPol
WITH (STATE = OFF);
GO