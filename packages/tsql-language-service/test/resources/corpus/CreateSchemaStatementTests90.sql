create schema authorization dev
grant create to null with grant option
GO
create schema authorization dev
deny create control alter on type::a.b..d to public, null, [user1], user2;
GO
create schema authorization dev
revoke grant option for view definition control create alter (c1, c2, c3) on OBJECT::a.b..d from public, null, [user1], user2 cascade as c1
GO

-- multiple statements
create schema authorization dev
create table t1(c1 int)
Create View schema1.view1 AS SELECT * FROM schema1.table2
revoke all privileges to public as [p1]
GO
