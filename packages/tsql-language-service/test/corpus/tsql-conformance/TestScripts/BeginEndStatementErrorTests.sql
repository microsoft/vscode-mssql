-- sacaglar, comments inline...

-- this batch should have one error in it at BREA token
CREATE FUNCTION ISOweek (@DATE datetime)
RETURNS int
AS
BEGIN
   BREA
END
GO

-- this batch should have one error in it at BREA token
CREATE FUNCTION ISOweek (@DATE datetime)
RETURNS int
AS
BEGIN
   BREA
   create table t1(c1 int);
   create table t2(c1 int);
END
