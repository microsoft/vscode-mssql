create availability group group1 with(required_copies_to_commit=10) 
for database db1, db2 
replica on 'server1' with(availability_mode = synchronous_commit, failover_mode=automatic, endpoint_url='TCP://1234:80', secondary_role (allow_connections=no), session_timeout=10, apply_delay=1),
'server2' with(failover_mode=manual, apply_delay=1, endpoint_url='TCP://1234:80', primary_role (allow_connections=read_write), availability_mode = asynchronous_commit, session_timeout=10 ),
'server3' with(availability_mode = synchronous_commit, failover_mode=automatic, endpoint_url='TCP://1234:80', secondary_role (allow_connections=all), session_timeout=10, apply_delay=1)
go
create availability group group1 with(required_copies_to_commit=10) 
for database db1, db2 
replica on 'server1' with(availability_mode = synchronous_commit, failover_mode=automatic, endpoint_url='TCP://1234:80', secondary_role (allow_connections=read_only), session_timeout=10, apply_delay=1),
'server2' with(failover_mode=manual, apply_delay=1, endpoint_url='TCP://1234:80', primary_role (allow_connections=all), availability_mode = asynchronous_commit, session_timeout=10 )
go