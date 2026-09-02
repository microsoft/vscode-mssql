-- openrowset bulk with CSV format options
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'CSV') as a;
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'CSV', codepage = 'OEM', rows_per_batch = 2, lastrow = 10) as a;
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'CSV', firstrow = 1, lastrow = 10, maxerrors = 0, rows_per_batch = 1, order (c1 asc, c2 desc)) as a;
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'CSV', fieldquote = '"') as a;
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'CSV', fieldquote = '"', codepage = 'RAW') as a;
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'CSV', fieldquote = '"', order (c1), errorfile = 'ef1') as a;
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'CSV', fieldquote = '"', firstrow = 5, lastrow = 10, maxerrors = 0, rows_per_batch = 1) as a;
select * from openrowset(bulk 'f1', formatfile = 'ff1', format = 'Csv') as a;
select * from openrowset(bulk 'f1', fieldquote = '"', format = 'csV', formatfile = 'ff1') as a;