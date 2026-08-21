-- sacaglar, comments inline

-- basic while
while @a > 10
	create table t1 (c1 int)
	
-- while with begin end, if, break and continue
while @a > 10
	begin
	if (@b > 10)
		break
	else
		if (@c = 20)
			continue
	end
	
