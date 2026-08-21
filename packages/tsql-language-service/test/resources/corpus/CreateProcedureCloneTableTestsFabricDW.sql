CREATE PROCEDURE CloneEmployeeLocal
AS
CREATE TABLE dbo.Employee AS CLONE OF dbo.EmployeeUSA;


GO
CREATE PROCEDURE CloneEmployeeFromDbo1
AS
CREATE TABLE dbo.Employee AS CLONE OF dbo1.EmployeeUSA;


GO
CREATE PROCEDURE CloneEmployeeAtTimestamp
AS
CREATE TABLE dbo.Employee AS CLONE OF dbo.EmployeeUSA AT '2023-05-23T14:24:10.325';


GO
CREATE PROCEDURE CloneEmployeeFromDbo1AtTimestamp
AS
CREATE TABLE dbo.Employee AS CLONE OF dbo1.EmployeeUSA AT '2023-05-23T14:24:10';