create resource pool p with
(
cap_cpu_percent = 40,
target_memory_percent = 4,
min_io_percent = 17,
max_io_percent = 18,
cap_io_percent = 80
)

create resource pool p with
(
affinity scheduler = auto,
affinity scheduler = (50),
affinity scheduler = (50 to 60),
affinity scheduler = (4, 5 to 6, 70 to 80),
affinity numanode = (50),
affinity numanode = (50 to 60),
affinity numanode = (4, 5 to 6, 70 to 80),
affinity numanode = (4)
)

alter resource pool p with
(
cap_cpu_percent = 40,
target_memory_percent = 4,
min_io_percent = 17,
max_io_percent = 18,
cap_io_percent = 80
)

alter resource pool p with
(
affinity scheduler = auto,
affinity scheduler = (50),
affinity scheduler = (50 to 60),
affinity scheduler = (4, 5 to 6, 70 to 80),
affinity numanode = (50),
affinity numanode = (50 to 60),
affinity numanode = (4, 5 to 6, 70 to 80),
affinity numanode = (4)
)
