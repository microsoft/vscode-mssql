CREATE WORKLOAD CLASSIFIER wcAllOptions 
WITH  (
WORKLOAD_GROUP = 'wgDefaultParams',
MEMBERNAME     = 'ELTRole',
WLM_CONTEXT    = 'dim_load',
START_TIME     = '22:00',
END_TIME       = '02:00',
WLM_LABEL      = 'label',
IMPORTANCE     = HIGH
)