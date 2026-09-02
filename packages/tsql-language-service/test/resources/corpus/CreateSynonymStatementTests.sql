--sacaglar comments inline

-- most basic version
create synonym mysyn for t1;

-- multi part names
create synonym .mysyn2 for dbo.t1;

create synonym [dbo].[mysyn3] for ...t1;

create synonym dbo.mysyn4 for .[db]..t1;
