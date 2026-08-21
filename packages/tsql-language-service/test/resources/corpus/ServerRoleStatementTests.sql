-- Create server role statement
--basic
create server role r1

-- testing authorization
create server role [r1] authorization [dbo]

Go

-- Alter role statement
alter server role r1 with name = newName

alter server role r1 add member role_member

alter server role r1 drop member role_member

-- Grant alter on server role (permission)
grant alter on server role::serverRole1 to serverRole2

