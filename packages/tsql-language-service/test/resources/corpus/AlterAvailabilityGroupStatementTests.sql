alter availability group group1 join
go
alter availability group group1 add database db1, db2
go
alter availability group group1 remove database db1, db2, db3
go
alter availability group group1 add replica on 'server1' WITH(AVAILABILITY_MODE = SYNCHRONOUS_COMMIT, FAILOVER_MODE = AUTOMATIC, ENDPOINT_URL = 'TCP://1234:80', SECONDARY_ROLE (ALLOW_CONNECTIONS = NO), SESSION_TIMEOUT = 10, APPLY_DELAY = 1),
'server2' WITH(FAILOVER_MODE = MANUAL, APPLY_DELAY = 1, ENDPOINT_URL = 'TCP://1234:80', PRIMARY_ROLE (ALLOW_CONNECTIONS = READ_WRITE), AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT, SESSION_TIMEOUT = 10),
'server3' WITH(AVAILABILITY_MODE = SYNCHRONOUS_COMMIT, FAILOVER_MODE = AUTOMATIC, ENDPOINT_URL = 'TCP://1234:80', SECONDARY_ROLE (ALLOW_CONNECTIONS = all), SESSION_TIMEOUT = 10, APPLY_DELAY = 1)
go
alter availability group group1 modify replica on 'server1' WITH(AVAILABILITY_MODE = SYNCHRONOUS_COMMIT, FAILOVER_MODE = AUTOMATIC, ENDPOINT_URL = 'TCP://1234:80', SECONDARY_ROLE (ALLOW_CONNECTIONS = ALL), SESSION_TIMEOUT = 10, APPLY_DELAY = 1),
'server2' WITH(FAILOVER_MODE = MANUAL, APPLY_DELAY = 1, ENDPOINT_URL = 'TCP://1234:80', PRIMARY_ROLE (ALLOW_CONNECTIONS = all), AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT, SESSION_TIMEOUT = 10)
go
alter availability group group1 remove replica on 'server1', 'server2'
go
alter availability group group1 set(required_copies_to_commit=5)
go
alter availability group group1 failover
go
alter availability group group1 failover with(target='server1')
go
alter availability group group1 force_failover_allow_data_loss
go
alter availability group group1 online
go
alter availability group group1 offline
go