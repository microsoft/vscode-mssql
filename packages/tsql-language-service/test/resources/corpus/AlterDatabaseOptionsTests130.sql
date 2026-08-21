-- query_store option
alter database db set query_store = on;
alter database db set query_store = off;
alter database db set query_store clear;
alter database db set query_store clear all;
alter database db set query_store (desired_state = read_write);
alter database db set query_store (desired_state = read_only);
alter database db set query_store (operation_mode = read_write);
alter database db set query_store (operation_mode = read_only);
alter database db set query_store (query_capture_mode = none);
alter database db set query_store (query_capture_mode = auto);
alter database db set query_store (query_capture_mode = all);
alter database db set query_store (size_based_cleanup_mode = off);
alter database db set query_store (size_based_cleanup_mode = auto);
alter database db set query_store (flush_interval_seconds = 25000);
alter database db set query_store (data_flush_interval_seconds = 1000);
alter database db set query_store (interval_length_minutes = 15);
alter database db set query_store (max_storage_size_mb = 2000);
alter database db set query_store (max_plans_per_query = 200);
alter database db set query_store (cleanup_policy = (stale_query_threshold_days = 367));
alter database db set query_store (desired_state = read_only, query_capture_mode = all, size_based_cleanup_mode = off, interval_length_minutes = 100, max_storage_size_mb = 1000, max_plans_per_query = 200, cleanup_policy = (stale_query_threshold_days = 367));
alter database db set query_store = on(desired_state = read_only, query_capture_mode = all, size_based_cleanup_mode = off, interval_length_minutes = 100, max_storage_size_mb = 1000, max_plans_per_query = 200, cleanup_policy = (stale_query_threshold_days = 367));

-- mixed_page_allocation option
alter database db set mixed_page_allocation on
alter database db set mixed_page_allocation off