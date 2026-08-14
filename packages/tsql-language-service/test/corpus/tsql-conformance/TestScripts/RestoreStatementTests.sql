-- restore database, with devices
restore database db1
restore database @var1 from @var2
restore database db1 from tape = 'tape1', disk = 'd:', someDevice

-- restore transaction log
restore log db1
restore log @var2 from someDevice

-- options
restore database db1 from @var1 with checksum, continue_after_error, enable_broker
restore database db1 from @var1 with no_checksum, stop_on_error, error_broker_conversations
restore database db1 from @var1 with new_broker, file = 10, keep_replication
restore database db1 from @var1 with medianame = @mediaName, mediapassword = 'PLACEHOLDER1'
restore database db1 from @var1 with move 'name1' to 'name2', password = 'PLACEHOLDER1'
restore database db1 from @var1 with recovery, replace, restart, restricted_user
restore database db1 from @var1 with norecovery, rewind, unload, stats = 10, stopat = @dateVar
restore database db1 from @var1 with standby ='someFile', norewind, nounload, stats
restore database db1 from @var1 with stopatmark = 'm1', stopbeforemark = 'm2' after @somedate

-- headeronly and similar stuff
restore filelistonly from @var1
restore verifyonly from tape = 'tape1'
restore labelonly from disk = 'd:'
restore rewindonly from someDevice
restore rewindonly from @var1 with norecovery

--Optional file arguments
RESTORE DATABASE AdventureWorks
   FILE = 'foo'
   FROM DISK = 'Z:\SQLServerBackups\AdventureWorks.bak'
   WITH 
   NORECOVERY;

