-- Delayed durability option
alter database d1 set delayed_durability = disabled;
alter database d1 set delayed_durability = allowed;
alter database d1 set delayed_durability = forced;
alter database d1 set MEMORY_OPTIMIZED_ELEVATE_TO_SNAPSHOT = on;