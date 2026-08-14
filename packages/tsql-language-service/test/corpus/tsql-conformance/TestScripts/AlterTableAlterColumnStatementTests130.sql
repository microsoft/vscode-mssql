-- sacaglar: Comments inline

Alter Table dbo.t1 alter column [my column] add rowguidcol with (online=on); -- Testing add rowguidcol, and two part name, online on

Alter Table dbo.t1 alter column [my column] add rowguidcol with (online=off); -- Testing add rowguidcol, and two part name, online off

alter table [tempdb].dbo.[table 2] alter column c1 drop rowguidcol with (online=on); -- Testing drop rowguidcol, and three part name, online on

alter table [tempdb].dbo.[table 2] alter column c1 drop rowguidcol with (online=off); -- Testing drop rowguidcol, and three part name, online off

alter table t1 alter column c1 int with (online=on); -- Testing basic alter column, online on.

alter table t1 alter column c1 int with (online=off); -- Testing basic alter column, online off.

alter table t1 alter column c1 varchar(20) collate SomeCollation with (online=on); -- Testing collation, online on.

alter table t1 alter column c1 varchar(20) collate SomeCollation with (online=off); -- Testing collation, online off.
 
alter table t1 alter column c1 varchar(20) collate SomeCollation null with (online=on); -- Testing collation + null, online on.

alter table t1 alter column c1 varchar(20) collate SomeCollation null with (online=off); -- Testing collation + null, online off.

alter table t1 alter column c1 int null with (online=on); -- Testing null, online on.

alter table t1 alter column c1 int null with (online=off); -- Testing null, online off.

alter table t1 alter column c1 int not null with (online=on); -- Testing not null, online on.

alter table t1 alter column c1 int not null with (online=off); -- Testing not null, online off.

alter table t1 alter column c1 add not for replication with (online=on); -- Testing add not for replication, online on.

alter table t1 alter column c1 add not for replication with (online=off); -- Testing add not for replication, online off.

alter table t1 alter column c1 drop not for replication with (online=on); -- Testing drop not for replication, online on.

alter table t1 alter column c1 drop not for replication with (online=off); -- Testing drop not for replication, online off.

ALTER TABLE t1 ALTER COLUMN c1 ADD MASKED WITH (FUNCTION = 'default()'); -- Adds a data masking function to one column.

ALTER TABLE t1 ALTER COLUMN c1 DROP MASKED; -- Drops a data masking function from one column.

ALTER TABLE t1 ALTER COLUMN c1 VARCHAR(20) MASKED WITH (FUNCTION = 'partial(3, "XXXX", 4)'); -- Changes the data masking function applied to one column.

ALTER TABLE t1 ALTER COLUMN c1 ADD HIDDEN; --adds hidden flag to temporal generated always column.

ALTER TABLE t1 ALTER COLUMN c1 DROP HIDDEN; --drops hidden flag from temporal generated always column.

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid start; -- Changes column to be temporal generated always as suser_sid start

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid end; -- Changes column to be temporal generated always as suser_sid end

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname start; -- Changes column to be temporal generated always as suser_sname start

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname end; -- Changes column to be temporal generated always as suser_sname end

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid start hidden; -- Changes column to be temporal generated always as suser_sid start and adds hidden flag

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid end hidden; -- Changes column to be temporal generated always as suser_sid end and adds hidden flag

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname start hidden; -- Changes column to be temporal generated always as suser_sname start and adds hidden flag

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname end hidden; -- Changes column to be temporal generated always as suser_sname end and adds hidden flag

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid start not null; -- Changes column to be temporal generated always as suser_sid start + not null

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid end not null; -- Changes column to be temporal generated always as suser_sid end + not null

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname start not null; -- Changes column to be temporal generated always as suser_sname start + not null

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname end not null; -- Changes column to be temporal generated always as suser_sname end + not null

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid start hidden not null; -- Changes column to be temporal generated always as suser_sid start and adds hidden flag + not null

ALTER TABLE t1 ALTER COLUMN c1 varbinary(85) generated always as suser_sid end hidden not null; -- Changes column to be temporal generated always as suser_sid end and adds hidden flag + not null

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname start hidden not null; -- Changes column to be temporal generated always as suser_sname start and adds hidden flag + not null

ALTER TABLE t1 ALTER COLUMN c1 nvarchar(128) generated always as suser_sname end hidden not null; -- Changes column to be temporal generated always as suser_sname end and adds hidden flag + not null
