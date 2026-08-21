-- sacaglar: Comments inline

Alter Table dbo.t1 alter column [my column] add rowguidcol; -- Testing add rowguidcol, and two part name

alter table [tempdb].dbo.[table 2] alter column c1 drop rowguidcol; -- Testing drop rowguidcol, and three part name

alter table t1 alter column c1 int; -- Testing basic alter column.

alter table t1 alter column c1 varchar(20) collate SomeCollation; -- Testing collation.
 
alter table t1 alter column c1 varchar(20) collate SomeCollation null; -- Testing collation + null.

alter table t1 alter column c1 int null; -- Testing null.

alter table t1 alter column c1 int not null; -- Testing not null.

alter table t1 alter column c1 add not for replication; -- Testing add not for replication.

alter table t1 alter column c1 drop not for replication; -- Testing drop not for replication.