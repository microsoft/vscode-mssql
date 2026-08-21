-- bulk insert with CSV format options
bulk insert t1 from 'f1' with (format = 'CSV');
bulk insert t1 from 'f1' with (format = 'CSV', formatfile = 'ff1');
bulk insert t1 from 'f1' with (format = 'CSV', fieldterminator = '!', datafiletype = 'char');
bulk insert t1 from 'f1' with (format = 'CSV', codepage = 'OEM', keepidentity, kilobytes_per_batch = 2, lastrow = 10);
bulk insert t1 from 'f1' with (format = 'CSV', firstrow = 1, lastrow = 10, maxerrors = 0, rows_per_batch = 1, order (c1 asc, c2 desc));
bulk insert t1 from 'f1' with (format = 'CSV', fieldquote = '"');
bulk insert t1 from 'f1' with (format = 'CSV', fieldquote = '"', codepage = 'RAW');
bulk insert t1 from 'f1' with (format = 'CSV', fieldquote = '"', formatfile = 'ff1', order (c1), errorfile = 'ef1');
bulk insert t1 from 'f1' with (format = 'CSV', fieldquote = '"', fieldterminator = ',', rowterminator = '\r\n', datafiletype = 'widechar');
bulk insert t1 from 'f1' with (format = 'CSV', fieldquote = '"', firstrow = 5, lastrow = 10, maxerrors = 0, rows_per_batch = 1, fire_triggers, keepnulls);
bulk insert t1 from 'f1' with (format = 'csv');
bulk insert t1 from 'f1' with (datafiletype = 'char', fieldquote = '"', format = 'cSv');
