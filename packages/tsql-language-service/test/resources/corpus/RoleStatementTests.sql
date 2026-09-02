-- sacaglar, comments inline

-- Create role statement
--basic
create role r1

-- testing authorization
create role [r1] authorization [dbo]

Go

-- Alter role statement
alter role r1 with name = newName
