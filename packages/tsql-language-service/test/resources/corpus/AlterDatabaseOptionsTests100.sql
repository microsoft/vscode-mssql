-- Compatibility level option
alter database d1 set compatibility_level = 90
alter database d1 set compatibility_level = 10

-- New on/off options
alter database d1 set encryption on, encryption off
alter database d1 set honor_broker_priority on, vardecimal_storage_format off
alter database d1 set vardecimal_storage_format on, honor_broker_priority off

-- Change tracking option
alter database d1 set change_tracking = off
alter database d1 set change_tracking = on
alter database d1 set change_tracking = on (auto_cleanup = on)
alter database d1 set change_tracking (auto_cleanup = off, change_retention = 100 hours)
alter database d1 set change_tracking (change_retention = 3 days)
alter database d1 set change_tracking (change_retention = 5 minutes, auto_cleanup = off)