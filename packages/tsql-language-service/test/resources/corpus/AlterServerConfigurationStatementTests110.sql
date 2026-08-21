alter server configuration set diagnostics log on

alter server configuration set diagnostics log off

alter server configuration set diagnostics log max_size = 852 mb

alter server configuration set diagnostics log max_files = 24

alter server configuration set diagnostics log path = 'hello'

alter server configuration set diagnostics log max_size = default

alter server configuration set diagnostics log max_files = default

alter server configuration set diagnostics log path = default


alter server configuration set failover cluster property VerboseLogging = 2
 
alter server configuration set failover cluster property SqlDumperDumpFlags = 0x0118124deadbeef

alter server configuration set failover cluster property SqlDumperDumpPath = 'c:\foo'

alter server configuration set failover cluster property SqlDumperDumpTimeout = 600

alter server configuration set failover cluster property FailureConditionLevel = 1

alter server configuration set failover cluster property HealthCheckTimeout = 1200

alter server configuration set failover cluster property VerboseLogging = default

alter server configuration set failover cluster property SqlDumperDumpFlags = default

alter server configuration set failover cluster property SqlDumperDumpPath = default

alter server configuration set failover cluster property SqlDumperDumpTimeout = default

alter server configuration set failover cluster property FailureConditionLevel = default

alter server configuration set failover cluster property HealthCheckTimeout = default


alter server configuration set buffer pool extension on ( filename = 'foo', size = 4349 kb )

alter server configuration set buffer pool extension on ( filename = 'foo', size = 654 mb )

alter server configuration set buffer pool extension on ( filename = 'foo', size = 42 gb )

alter server configuration set buffer pool extension off


alter server configuration set hadr cluster context = 'foo'

alter server configuration set hadr cluster context = local