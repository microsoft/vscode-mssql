-- sacaglar: comments inline, these statements may not make sense semantically

-- testing grant statement
grant view definition control create alter (c1, c2, c3) on Application Role :: a.b..d to public, null, [user1], user2 with grant option as c1
grant all privileges on Assembly :: a.b..d (c1, c2) to public
grant control on asymmetric key :: a.b..d to null as c1
grant create control alter on Certificate :: a.b..d to public, null, [user1], user2
grant create control alter on [a] to null, user2 as [all]
grant create on Contract::[c1] to null with grant option
grant create to null with grant option as [p1]
grant control (c1) to public as [p1]
grant control on t1(c1) to public as [p1]
grant all privileges to public as [p1]

-- testing deny statement
deny view definition control create alter (c1, c2, c3) on Database :: a.b..d to public, null, [user1], user2 cascade as c1
deny all privileges on Endpoint :: a.b..d (c1, c2) to public
deny control on Fulltext Catalog :: a.b..d to null as c1
deny create control alter on Login :: a.b..d to public, null, [user1], user2
deny create control alter on [a] to null, user2 as [all]
deny create on Message Type::m1 to null cascade
deny create to null cascade as [p1]
deny control (c1) to public as [p1]
deny control on t1(c1) to public as [p1]
deny all privileges to public as [p1]

-- testing revoke statement
revoke grant option for view definition control create alter (c1, c2, c3) on OBJECT :: a.b..d from public, null, [user1], user2 cascade as c1
revoke view definition control create alter (c1, c2, c3) on Remote Service Binding :: a.b..d to public, null, [user1], user2 cascade as c1
revoke all privileges on Role :: a.b..d (c1, c2) from public
revoke control on Route :: a.b..d to null as c1
revoke create control alter on Schema :: a.b..d to public, null, [user1], user2
revoke create control alter on [a] to null, user2 as [all]
revoke create on Server::s1 to null cascade
revoke create to null cascade as [p1]
revoke control (c1) from public as [p1]
revoke grant option for control on t1(c1) to public as [p1]
revoke all privileges to public as [p1]

--testing alter authorization statement
ALTER AUTHORIZATION ON OBJECT::Parts.Sprockets TO MichikoOsada
ALTER AUTHORIZATION ON Parts.Sprockets TO [MichikoOsada]
ALTER AUTHORIZATION ON OBJECT::ProductionView06 TO SCHEMA OWNER
ALTER AUTHORIZATION ON Service::..ProductionView06 TO SCHEMA OWNER

--testing the rest of the SecurityObjectKinds including XmlSchemaCollection which is invalid in GDR statements
ALTER AUTHORIZATION ON Symmetric Key::Parts.Sprockets TO [c1]
ALTER AUTHORIZATION ON Type::Parts.Sprockets TO [c1]
ALTER AUTHORIZATION ON User::Parts.Sprockets TO [c1]
ALTER AUTHORIZATION ON Xml Schema Collection::Parts.Sprockets TO [c1]
ALTER AUTHORIZATION on search property list :: list1 to [c1]
ALTER AUTHORIZATION on availability group :: ag1 to [c1]

-- bug 610269
GRANT EXECUTE ON XML SCHEMA COLLECTION::  [dm].[OrderCombined_v1r1m1] TO [db_spexecute]

--testing all security object kinds in GDR
grant control on application role :: app1 to public
grant control on asymmetric key :: key1 to public
grant control on fulltext catalog :: cat1 to public
grant control on fulltext stoplist :: stoplist1 to public
grant control on message type :: message1 to public
grant control on symmetric key :: key1 to public
grant control on xml schema collection :: xsc1 to public
grant control on remote service binding :: rsb1 to public
grant control on search property list :: list1 to public
grant control on availability group :: ag1 to public

