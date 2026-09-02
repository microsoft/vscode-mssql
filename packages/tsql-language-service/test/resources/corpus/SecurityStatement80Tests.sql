-- sacaglar: comments inline

-- testing grant statement
-- testing privilige
grant SELECT on ..t1 to public
grant INSERT on ..t1(c1) to public
grant ALL PRIVILEGES on ..t1 (c1, c2, c3) to public
grant ALL, SELECT (c1, c2), INSERT, DELETE, UPDATE, EXEC, EXECUTE, REFERENCES(c1, c2) on t2 to guest

-- testing commands, users, as clause, with grant option
grant CREATE DATABASE to public as [clause]
grant CREATE DEFAULT to [guest]
grant CREATE FUNCTION to [guest]
grant CREATE PROCEDURE to [guest]
grant CREATE RULE to [guest]
grant CREATE TABLE to [guest]
grant CREATE VIEW to [guest]
grant BACKUP DATABASE to [guest]
grant BACKUP LOG to [guest]
grant CREATE DATABASE, CREATE DEFAULT, CREATE FUNCTION, CREATE PROCEDURE, CREATE RULE, CREATE TABLE, CREATE VIEW, BACKUP DATABASE, BACKUP LOG to [guest]
grant ALL TO NULL with grant option

-- testing all together
grant all to public with grant option as t1

-- testing deny statement
deny select on t2 to null
deny create view to [guest]
deny all to public cascade

-- testing revoke statement
revoke grant option for select on t2 to null
revoke create view to [guest]
revoke create view from [guest] as role1
revoke all to public cascade
revoke all to public cascade as [group 2]
