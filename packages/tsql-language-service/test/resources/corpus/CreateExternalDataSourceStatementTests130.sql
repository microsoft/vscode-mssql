CREATE EXTERNAL DATA SOURCE eds1
    WITH (
    TYPE = HADOOP,
    LOCATION = 'protocol://ip_address:port'
    );

CREATE EXTERNAL DATA SOURCE eds2
    WITH (
    TYPE = HADOOP,
    LOCATION = 'protocol://ip_address:port',
    RESOURCE_MANAGER_LOCATION = 'ip_address:port'
    );

CREATE EXTERNAL DATA SOURCE eds3
    WITH (
    TYPE = HADOOP,
    LOCATION = 'protocol://ip_address:port',
    CREDENTIAL = cred1
    );

CREATE EXTERNAL DATA SOURCE eds4
    WITH (
    TYPE = HADOOP,
    LOCATION = 'protocol://ip_address:port',
    RESOURCE_MANAGER_LOCATION = 'ip_address:port',
    CREDENTIAL = cred1
    );

CREATE EXTERNAL DATA SOURCE eds5
    WITH (
    TYPE = HADOOP,
    LOCATION = 'protocol://ip_address:port',
    CREDENTIAL = cred1,
    RESOURCE_MANAGER_LOCATION = 'ip_address:port'
    );

CREATE EXTERNAL DATA SOURCE eds6
    WITH (
    TYPE = SHARD_MAP_MANAGER,
    LOCATION = 'someServerLocation',
    CREDENTIAL = cred1,
    DATABASE_NAME = 'someDatabaseName',
    SHARD_MAP_NAME = 'someShardMapName'
    );

CREATE EXTERNAL DATA SOURCE eds7
    WITH (
    TYPE = SHARD_MAP_MANAGER,
    LOCATION = 'someServerLocation',
    CREDENTIAL = cred1,
    SHARD_MAP_NAME = 'someShardMapName',
    DATABASE_NAME = 'someDatabaseName'
    );

CREATE EXTERNAL DATA SOURCE eds8
    WITH (
    TYPE = SHARD_MAP_MANAGER,
    LOCATION = 'someServerLocation',
    DATABASE_NAME = 'someDatabaseName',
    CREDENTIAL = cred1,
    SHARD_MAP_NAME = 'someShardMapName'
    );

CREATE EXTERNAL DATA SOURCE eds9
    WITH (
    TYPE = SHARD_MAP_MANAGER,
    LOCATION = 'someServerLocation',
    DATABASE_NAME = 'someDatabaseName',
    SHARD_MAP_NAME = 'someShardMapName',
    CREDENTIAL = cred1
    );

CREATE EXTERNAL DATA SOURCE eds10
    WITH (
    TYPE = SHARD_MAP_MANAGER,
    LOCATION = 'someServerLocation',
    SHARD_MAP_NAME = 'someShardMapName',
    CREDENTIAL = cred1,
    DATABASE_NAME = 'someDatabaseName'
    );

CREATE EXTERNAL DATA SOURCE eds11
    WITH (
    TYPE = SHARD_MAP_MANAGER,
    LOCATION = 'someServerLocation',
    SHARD_MAP_NAME = 'someShardMapName',
    DATABASE_NAME = 'someDatabaseName',
    CREDENTIAL = cred1
    );

CREATE EXTERNAL DATA SOURCE eds12
    WITH (
    TYPE = RDBMS,
    LOCATION = 'someServerLocation',
    DATABASE_NAME = 'someDatabaseName',
    CREDENTIAL = cred1
    );

CREATE EXTERNAL DATA SOURCE eds13
    WITH (
    TYPE = RDBMS,
    LOCATION = 'someServerLocation',
    CREDENTIAL = cred1,
    DATABASE_NAME = 'someDatabaseName'
    );