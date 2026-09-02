create workload group g with
(
group_min_memory_percent = 42
)

create workload group g with
(
group_min_memory_percent = 42,
max_dop=52
)

alter workload group g with
(
group_min_memory_percent = 42
)

alter workload group g with
(
group_min_memory_percent = 42,
max_dop=52
)
