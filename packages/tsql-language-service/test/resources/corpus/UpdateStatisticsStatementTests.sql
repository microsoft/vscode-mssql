--sacaglar comments inline

-- most basic version
update statistics t1;

-- single name /wo paranthesis
update statistics t1 st1;

-- 2 part name, multiple sub elements
update statistics [dbo].t1 (index1, stat1, stat2) 
go

-- with options
update statistics t1 (c1) with All;
update statistics t1 (c1) with fullscan, resample 
update statistics [dbo].t1 (c1, c2) with norecompute, sample 1 percent, columns;
update statistics t1 (c1, c2, c3) with sample 11 rows, norecompute, index;

update statistics t1 (c1, c2, c3) with rowcount = 100;
update statistics t1 (c1, c2, c3) with pagecount = 2;


