-- DBCC statement without options
dbcc myDll
dbcc tracestatus ()
dbcc tracestatus (2528, 3205)
DBCC CLEANTABLE ('AdventureWorks','Production.Document', 0)
dbcc Something (a = NULL)
dbcc Something (b = -100)

-- DBCC options
dbcc myDll with all_errormsgs, count_rows, no_infomsgs, tableresults
dbcc myDll with tablock, stat_header, density_vector, histogram_steps
dbcc myDll with estimateonly, fast, all_levels, all_indexes, physical_only
dbcc myDll with all_constraints, stats_stream, histogram, data_purity, mark_in_use_for_removal

dbcc myDll with stat_header join density_vector join stat_header
