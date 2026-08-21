--sacaglar comments inline

-- most basic version
create statistics st1 on t1 (c1);

-- 2 part name, multiple columns
create statistics st1 on [dbo].t1 (c1, c2, c3) 
go

-- with options
create statistics [stat] on t1 (c1) with fullscan;
create statistics [stat] on t1 (c1, c2) with norecompute, sample 12 percent;
create statistics [stat] on t1 (c1, c2, c3) with sample 12 rows, norecompute;