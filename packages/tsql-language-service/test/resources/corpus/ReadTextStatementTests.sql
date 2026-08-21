-- sacaglar, comments inline

-- all variations
readtext t1.c1 @ptrval 1 @size 
readtext ..t1.c1 0xAB10002000FFFFFF @offset 25
readtext master.dbo.t1.c1 @ptr 0 25 Holdlock