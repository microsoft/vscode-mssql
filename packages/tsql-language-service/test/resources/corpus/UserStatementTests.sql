-- sacaglar, comments inline

-- Create user statement
--basic
create user u1

-- testing for/from
create user [u1] for login [l1]
create user [u1] from login l1
create user u1 for certificate c1
create user u1 from asymmetric key a1

-- testing without login 
create user u1 without login

-- testing option
create user u1 with default_schema = dbo

-- testing all together
create user u1 from certificate c1 with default_schema = [dbo]
create user u1 for asymmetric key a1 with default_schema = dbo

Go

-- Alter user statement
alter user u1 with default_schema = dbo
alter user u1 with name = newName
alter user u1 with name = newName, default_schema = dbo, login = l1
