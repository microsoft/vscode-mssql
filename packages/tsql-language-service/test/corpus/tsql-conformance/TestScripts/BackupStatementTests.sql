-- Backup database with devices
backup database d1  to someDevice
backup database d1  to @deviceName, DISK = 'c:', TAPE = @tapeName

-- Backup transaction log
backup log d1 to someDevice
backup log @Var2 to someDevice

-- file/filegroup lists
backup database d1 file = 'f1', file = @var3, file = ('f2',@var4) to tape = '\\.\tape1'
backup database d1 filegroup = 'f1' to tape = '\\.\tape1'
backup database d1 filegroup = (@var5, @var6) to tape = '\\.\tape1'
backup database d1 filegroup = 'fg1', filegroup = 'fg2', file = 'f3' to disk = 'd:'

--options
backup database d1 to disk = 'd:' with blocksize = 10, buffercount = @count, checksum
backup database d1 to disk = 'd:' with no_checksum, continue_after_error, description = 'd1'
backup database d1 to disk = 'd:' with stop_on_error, differential, expiredate = @today
backup database d1 to disk = 'd:' with medianame = 'someMedia', mediadescription = 'md1'
backup database d1 to disk = 'd:' with retaindays = 10, format
backup database d1 to disk = 'd:' with noformat, init, skip, rewind, unload, stats
backup database d1 to disk = 'd:' with noinit, noskip, norewind, nounload, restart, copy_only
backup database d1 to disk = 'd:' with stats = 10, name = 'someName', maxtransfersize = @size
backup database d1 to disk = 'd:' with no_truncate, norecovery
backup database d1 to disk = 'd:' with standby = 'undo_file_name'

-- NO_LOG and TRUNCATE_ONLY options are not supported in Katmai, but due to upgrade issue we still support them
BACKUP DATABASE d1 TO someDevice WITH NO_LOG
BACKUP DATABASE d1 TO someDevice WITH TRUNCATE_ONLY
