alter database d1 set emergency

alter database d1 set db_chaining on, trustworthy off
alter database d1 set trustworthy on, db_chaining off

alter database d1 set auto_update_statistics_async off

alter database d1 set page_verify checksum, page_verify none, page_verify torn_page_detection

-- <database_mirroring_option>, <service_broker_option>
alter database d1 set partner = 'some_server', partner failover
alter database d1 set witness = 'witness', partner force_service_allow_data_loss, partner resume
alter database d1 set error_broker_conversations, partner safety full, partner suspend
alter database d1 set enable_broker, partner safety off, partner timeout 10
alter database d1 set disable_broker, witness off
alter database d1 set new_broker

-- <date_correlation_optimization_option>, <parameterization_option>
alter database d1 set DATE_CORRELATION_OPTIMIZATION ON, PARAMETERIZATION SIMPLE
alter database d1 set PARAMETERIZATION FORCED, DATE_CORRELATION_OPTIMIZATION OFF

-- <snapshot_option>
alter database d1 set ALLOW_SNAPSHOT_ISOLATION ON, READ_COMMITTED_SNAPSHOT ON
alter database d1 set READ_COMMITTED_SNAPSHOT OFF, ALLOW_SNAPSHOT_ISOLATION OFF

alter database d1 set supplemental_logging off

