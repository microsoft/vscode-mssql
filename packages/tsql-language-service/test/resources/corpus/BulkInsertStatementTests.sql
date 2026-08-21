-- bulk insert, no options
bulk insert db1.dbo.t1 from 'dataFile'
bulk insert dbo.t1 from someFile
bulk insert v1 from 11

-- bulk insert with options
bulk insert t1 from 'f1' with (batchsize = 10, check_constraints, codepage = 866, datafiletype = 'char')
bulk insert t1 from 'f1' with (batchsize = 10, check_constraints, codepage = '866', datafiletype = 'char')
bulk insert t1 from 'f1' with (batchsize = 10, check_constraints, codepage = '65001', datafiletype = 'char')
bulk insert t1 from 'f1' with (codepage = 'ACP', datafiletype = 'native', fieldterminator = ':')
bulk insert t1 from 'f1' with (codepage = 'OEM', datafiletype = 'widechar', firstrow = 5)
bulk insert t1 from 'f1' with (codepage = 'RAW', datafiletype = 'widenative', fire_triggers, keepnulls)
bulk insert t1 from 'f1' with (formatfile = 'SomeFile', keepidentity, kilobytes_per_batch = 2, lastrow = 10)
bulk insert t1 from 'f1' with (maxerrors = 0, order (timestamp ASC, t1 DESC, t2), datafiletype = 'widechar_ansi')
bulk insert t1 from 'f1' with (order (t1), rowterminator = '!', tablock, datafiletype = 'dts_buffers')
bulk insert t1 from 'f1' with (errorfile='file1', no_triggers)
bulk insert t1 from 'f1' with (rows_per_batch = 1)
bulk insert t1 from 'f1' with (rows_per_batch = 100.0)
bulk insert t1 from 'f1' with (include_hidden)
bulk insert t1 from 'f1' with (include_hidden, rows_per_batch = 100)

-- insert bulk, no options
insert bulk  db1.dbo.t1 
insert bulk dbo.t1 (c1 int not null, c2 char, timestamp)
insert bulk v1 (c1 int null)

-- insert bulk with options
insert bulk v1 with (order (t1))
insert bulk v1 with (check_constraints, fire_triggers, keepnulls, tablock, no_triggers)
insert bulk v1 with (rows_per_batch = 100, kilobytes_per_batch = 64)

