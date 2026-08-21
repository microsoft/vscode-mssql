-- sacaglar: Comments inline

-- These scripts also test the on and textimage_on parts

CREATE TABLE [database].A_Schema.A_TABLE (
	A0 varchar(10), -- simple column definition
	A1 int identity(5, 10), -- identity
	A12 int identity(+100000, -2), -- identity with signs
    A13 int identity (1., 1.), -- identity as numeric
	A2 int identity(1, 3) NOT FOR REPLICATION, -- not for replication
	A21 int identity NOT FOR REPLICATION, -- not for replication
	[no action] int identity(100, 10000) NOT FOR REPLICATION ROWGUIDCOL, -- no action, not for replication, and rowguidcol
	A3 as -A1, -- Check computed column
	A4 as (+-(A2)) Unique, -- Check computed column with unique
	A5 as A0 constraint PK_KEY Primary key,	-- Check computed column, with constraints
	A6 int default 200 constraint PK_KEY primary key constraint CkConstraint check (A6 < A5), -- Check computed column, with constraints
	A7 float default 23.54, -- Check default
	A8 float constraint DefCons default 3.14, -- Check named default
	A9 int CONSTRAINT [book_ratings_title_id] FOREIGN KEY REFERENCES [titles] ([title_id]) ON UPDATE CASCADE ON DELETE CASCADE,
	-- mixing with table level constraints
	UNIQUE CLUSTERED (A1 ASC, A2 DESC) WITH FILLFACTOR = 25 ON [DEFAULT],
	PRIMARY KEY CLUSTERED (A1 ASC, A2 DESC) WITH FILLFACTOR = 25 ON [ThisGroup],
	CONSTRAINT C1 FOREIGN KEY REFERENCES DB.Sch.T1 (C1) ON DELETE CASCADE ON UPDATE nO  
		aCTION NOT FOR REPLICATION,
	CONSTRAINT C2 FOREIGN KEY (A1) REFERENCES DB.Sch.T1 (C1) ON DELETE CASCADE ON UPDATE No ACTiON
);
GO
-- tests around timestamp column
create table g2 (timestamp not null primary key, check (1 < 2)) Textimage_on [default]
GO
create table g2 (c1 timestamp not null primary key, check (1 < 2)) on [fg]
GO
create table g2 (timestamp int not null primary key, check (1 < 2)) on [fg] Textimage_on [default]
GO
CREATE TABLE foo (id int NOT NULL, name VARCHAR(100) CONSTRAINT PK_CR PRIMARY KEY NONCLUSTERED (id asc)) Textimage_on [default]
GO
CREATE TABLE t1 (c1 text not null) ON 'default' TEXTIMAGE_ON 'default'
GO
