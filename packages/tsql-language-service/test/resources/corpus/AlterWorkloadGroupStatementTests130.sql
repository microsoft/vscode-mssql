alter workload group g using external p_ext;

alter workload group g using p_int, external p_ext;

alter workload group g using external p_ext, p_int;

alter workload group g with (request_max_memory_grant_percent = 20, importance = high, max_dop = 20, request_max_cpu_time_sec = 10, request_memory_grant_timeout_sec = 40, group_max_requests = 10) using external p_ext, p_int;

alter workload group g with (request_max_memory_grant_percent = 20, importance = high, max_dop = 20, request_max_cpu_time_sec = 10, request_memory_grant_timeout_sec = 40, group_max_requests = 10) using p_int, external p_ext;

alter workload group g with (request_max_memory_grant_percent = 20, importance = high, max_dop = 20, request_max_cpu_time_sec = 10, request_memory_grant_timeout_sec = 40, group_max_requests = 10) using external p_ext;