alter external resource pool p with (max_cpu_percent = 1);

alter external resource pool p with (max_memory_percent = 100);

alter external resource pool p with (max_processes = 10);

alter external resource pool p with (max_memory_percent = 50, max_cpu_percent = 20);

alter external resource pool p with (max_memory_percent = 50, max_processes = 1);

alter external resource pool p with (max_processes = 50, max_cpu_percent = 1);

alter external resource pool p with (max_cpu_percent = 30, max_processes = 1, max_memory_percent = 50);

alter external resource pool p with (max_cpu_percent = 30, max_processes = 165463, max_memory_percent = 50);

alter external resource pool p with (affinity cpu = auto)

alter external resource pool p with (affinity cpu = (1))

alter external resource pool p with (affinity cpu = (1 to 5, 6 to 7))

alter external resource pool p with (affinity numanode = (1))

alter external resource pool p with (affinity numanode = (1 to 5, 6 to 7))

alter external resource pool p with (max_cpu_percent = 30, max_processes = 165463, max_memory_percent = 50, affinity numanode = (1 to 5));