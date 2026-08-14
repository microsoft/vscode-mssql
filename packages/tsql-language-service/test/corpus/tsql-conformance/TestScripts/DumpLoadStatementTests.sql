-- DUMP is old syntax for BACKUP
DUMP DATABASE d1 TO someDevice
DUMP DATABASE d1 TO @deviceName, DISK = 'c:', TAPE = @tapeName
go

-- BACKUP TRANSACTION is not supported in Katmai
BACKUP TRANSACTION d1 TO someDevice
GO
BACKUP TRAN d1 TO someDevice
GO

-- LOAD is old syntax for RESTORE
LOAD DATABASE db1
GO

-- RESTORE TRANSACTION is not supported in Katmai
RESTORE TRANSACTION @var2 FROM someDevice
GO
RESTORE TRAN @var2 FROM someDevice
