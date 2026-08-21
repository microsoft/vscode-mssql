CREATE SERVER AUDIT a1 TO FILE (FILEPATH='aaa', max_files=10) with (on_failure=fail_operation) where c1 = 1
go

alter server audit a1 where c1 = 1
go

alter server audit a1 remove where
go

alter SERVER AUDIT a1 TO FILE (FILEPATH='aaa', max_files=10) with (on_failure=fail_operation, queue_delay=2) where c1 = 1
go
