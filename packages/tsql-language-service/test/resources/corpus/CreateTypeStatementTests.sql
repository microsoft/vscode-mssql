--sacaglar comments inline

-- Uddt
Create Type SSN From varchar(11) NOT NULL;
Create Type [schema].SSN From int NULL;
Create Type [schema].SSN From decimal(max);

-- Udt
Create Type SSN External Name [SomeAssembly];
Create Type Utf8String External Name utf8string.[Microsoft.Samples.SqlServer.utf8string]
