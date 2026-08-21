-- sacaglar, comments inline

-- label and goto
start:
create table t1 (c1 int)

if @a > 3
	goto start
else 
	goto finish
	
finish:

Go

create procedure __Test
as
set nocount on
gogo:
return
