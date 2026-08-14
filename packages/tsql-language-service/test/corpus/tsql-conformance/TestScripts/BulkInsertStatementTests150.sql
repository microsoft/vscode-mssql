-- bulk insert with CSV format options with escapechar.
bulk insert t1 from 'f1' with (format = 'CSV', escapechar = '\\');
bulk insert t1 from 'f1' with (format = 'CSV', escapechar = N'#', codepage = 'RAW');
bulk insert t1 from 'f1' with (format = 'CSV', escapechar = '\\', fieldquote = '#', codepage = 'RAW');
bulk insert t1 from 'f1' with (format = 'CSV', escapechar = '\\', formatfile = 'ff1', order (c1), errorfile = 'ef1');
bulk insert t1 from 'f1' with (format = 'CSV', escapechar = '\\', fieldterminator = ',', rowterminator = '\r\n', datafiletype = 'widechar');
bulk insert t1 from 'f1' with (format = 'CSV', escapechar = '\\', firstrow = 5, lastrow = 10, maxerrors = 0, rows_per_batch = 1, fire_triggers, keepnulls);
