-- automatic_tuning option
ALTER DATABASE db SET AUTOMATIC_TUNING = INHERIT;
ALTER DATABASE db SET AUTOMATIC_TUNING = CUSTOM;
ALTER DATABASE db SET AUTOMATIC_TUNING = AUTO;
ALTER DATABASE db SET AUTOMATIC_TUNING (CREATE_INDEX = ON);
ALTER DATABASE db SET AUTOMATIC_TUNING (CREATE_INDEX = OFF);
ALTER DATABASE db SET AUTOMATIC_TUNING (CREATE_INDEX = DEFAULT);
ALTER DATABASE db SET AUTOMATIC_TUNING (DROP_INDEX = ON);
ALTER DATABASE db SET AUTOMATIC_TUNING (DROP_INDEX = OFF);
ALTER DATABASE db SET AUTOMATIC_TUNING (DROP_INDEX = DEFAULT);
ALTER DATABASE db SET AUTOMATIC_TUNING (FORCE_LAST_GOOD_PLAN = ON);
ALTER DATABASE db SET AUTOMATIC_TUNING (FORCE_LAST_GOOD_PLAN = OFF);
ALTER DATABASE db SET AUTOMATIC_TUNING (FORCE_LAST_GOOD_PLAN = DEFAULT);
ALTER DATABASE db SET AUTOMATIC_TUNING (MAINTAIN_INDEX = ON);
ALTER DATABASE db SET AUTOMATIC_TUNING (MAINTAIN_INDEX = OFF);
ALTER DATABASE db SET AUTOMATIC_TUNING (MAINTAIN_INDEX = DEFAULT);
ALTER DATABASE db SET AUTOMATIC_TUNING (FORCE_LAST_GOOD_PLAN = ON, CREATE_INDEX = DEFAULT, MAINTAIN_INDEX = ON, DROP_INDEX = ON);
alter database db set automatic_tuning = auto;
ALtER DataBAsE db SET AUTomaTIC_TUNING (ForCE_LasT_GooD_PLAN = ofF);

-- query_store options for 2017+
alter database db set query_store (desired_state = read_only, query_capture_mode = all, size_based_cleanup_mode = off, interval_length_minutes = 100, max_storage_size_mb = 1000, max_plans_per_query = 200, cleanup_policy = (stale_query_threshold_days = 367), WAIT_STATS_CAPTURE_MODE = ON);
alter database db set query_store = on(desired_state = read_only, query_capture_mode = all, size_based_cleanup_mode = off, interval_length_minutes = 100, max_storage_size_mb = 1000, max_plans_per_query = 200, cleanup_policy = (stale_query_threshold_days = 367),  WAIT_STATS_CAPTURE_MODE = OFF);
