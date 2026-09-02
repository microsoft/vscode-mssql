-- sacaglar:  comments inline

-- use
use master
use [master]

go

-- kill
kill 12
kill -12 with statusonly
kill 'one'
kill N'one' with statusonly

go

-- checkpoint
checkpoint

go

-- reconfigure
reconfigure
reconfigure with override

go

-- shutdown

shutdown
shutdown with nowait

go

-- setuser
setuser 
setuser @user1
setuser 'user' with noreset
setuser N'user'

go

-- truncate table
truncate table ..[t1]
truncate table dbo.[t1]
truncate table [t1]

go

-- lineno
lineno 42
