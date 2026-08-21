-- Max dop --

alter database scoped configuration set maxdop = 0;

alter database scoped configuration set maxdop = 1;

alter database scoped configuration for secondary set maxdop = primary;

alter database scoped configuration for secondary set maxdop = 0;

alter database scoped configuration for secondary set maxdop = 1;

-- Legacy Cardinality Estimation --

alter database scoped configuration set legacy_cardinality_estimation = on;

alter database scoped configuration set legacy_cardinality_estimation = off;

alter database scoped configuration for secondary set legacy_cardinality_estimation = off;

alter database scoped configuration for secondary set legacy_cardinality_estimation = on;

alter database scoped configuration for secondary set legacy_cardinality_estimation = primary;

-- Parameter Sniffing --

alter database scoped configuration set parameter_sniffing = off;

alter database scoped configuration set parameter_sniffing = on;

alter database scoped configuration for secondary set parameter_sniffing = off;

alter database scoped configuration for secondary set parameter_sniffing = on;

alter database scoped configuration for secondary set parameter_sniffing = primary;

-- Query Optimizer Hotfixes

alter database scoped configuration set query_optimizer_hotfixes = off;

alter database scoped configuration set query_optimizer_hotfixes = on;

alter database scoped configuration for secondary set query_optimizer_hotfixes = off;

alter database scoped configuration for secondary set query_optimizer_hotfixes = on;

alter database scoped configuration for secondary set query_optimizer_hotfixes = primary;

-- Generic Options --

alter database scoped configuration set [new_option] = new_value;

alter database scoped configuration set new_option = new_value;

alter database scoped configuration set new_option = [new_value];

alter database scoped configuration set new_option = 'quoted_value';

alter database scoped configuration set new_option = [on];

alter database scoped configuration set new_option = on;

alter database scoped configuration set new_option = off;

alter database scoped configuration set new_option = 1;

alter database scoped configuration set new_option = -10;

alter database scoped configuration for secondary set new_option = primary;

alter database scoped configuration for secondary set new_option = new_value;


-- Clear Procedure Cache --

alter database scoped configuration clear procedure_cache;

alter database scoped configuration for secondary clear procedure_cache;
