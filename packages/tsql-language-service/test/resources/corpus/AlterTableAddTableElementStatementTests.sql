-- sacaglar: Comments inline

alter table t1 add check (c1 > 10), -- nameless check constraint
c2 int null, -- null
c3 as -c1 unique, -- computed column, unique constraint
constraint cs1 default 20 for c1, -- default constraint at table level
constraint cs2 default 20 for c10 with values, -- default constraint at table level with values
constraint cs3 check (c1 < 100), -- named check constraint at table level
c4 int default 23 with values, -- default constraint at column level with values
c5 int default 23, -- default constraint at column level  
c6 nvarchar(100) collate someCollatation; -- collation 

alter table t1 with NoCheck add constraint cs1 default 10 for c1; -- with nocheck

alter table t1 with Check add constraint cs1 default 10 for c1; -- with check

alter table t1 with Check add constraint C1 FOREIGN KEY REFERENCES DB.Sch.T1 (C1) ON DELETE CASCADE ON UPDATE no action NOT FOR REPLICATION; -- foreign key

ALTER TABLE [dbo].[book_ratings]  WITH CHECK ADD  CONSTRAINT [book_ratings_title_id] FOREIGN KEY([title_id]) REFERENCES [titles] ([title_id]) ON UPDATE CASCADE ON DELETE CASCADE

alter table t1 with Check add constraint C1 UNIQUE CLUSTERED (A1 ASC, A2 DESC) WITH FILLFACTOR = 25 ON [DEFAULT]; -- unique key

alter table t1 with Check add constraint C1 PRIMARY KEY CLUSTERED (A1 ASC, A2 DESC) WITH FILLFACTOR = 25; -- primary key

