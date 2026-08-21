-- sacaglar, comments inline

-- basic if
if @a > 10
	declare @b int
	
-- if else
if @a > 10 and @a < 20
	declare @b int
else
	declare @b varchar(10)
	

-- multiple if else
if 10 + 5 < @a
	declare @b int
else if 20 < @a
		declare @b float
	else 
		declare @b money
		
-- dangling else
if @a < 10
	if @a > 100
		declare @a int
	else
		declare @b float
		
-- complete nested if/else
if @a < 10
	if @a > 100
		declare @a int
	else
		declare @b float
else
	declare @c money
