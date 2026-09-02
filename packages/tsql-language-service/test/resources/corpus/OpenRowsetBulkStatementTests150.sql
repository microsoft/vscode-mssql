-- openrowset bulk with various format options with escapechar
select * from openrowset (bulk 'f1', formatfile = 'ff1', format = 'CSV', escapechar = N'\\', fieldquote = '"') as a;
select * from openrowset (bulk 'f1', formatfile = 'ff1', format = 'CSV', escapechar = '\\', codepage = 'RAW') as a;
select * from openrowset (bulk 'f1', formatfile = 'ff1', format = 'CSV', escapechar = '\\', order (c1), errorfile = 'ef1') as a;
select * from openrowset (bulk 'f1', formatfile = 'ff1', format = 'CSV', escapechar = '\\', firstrow = 5, lastrow = 10, maxerrors = 0, rows_per_batch = 1) as a;
select * from openrowset (bulk 'f1', escapechar = '\\', format = 'csV', formatfile = 'ff1') as a;
select * from openrowset (bulk 'f1', format = 'PARQUET') as a;
select * from openrowset (bulk 'f1', format = 'DELTA') as a;
select * from openrowset (bulk 'f1', format = 'PARQUET', fieldterminator = 'aa', rowterminator = 'bb', escapechar = 'd', firstrow = 1, fieldquote = 'e', data_compression = 'gzip', header_row = TRUE, datafiletype = 'widechar', codepage = 'ACP') as a;
select * from openrowset (bulk 'f1', format = 'CSV', fieldterminator = 'aa', rowterminator = 'bb', escapechar = 'd', firstrow = 1, fieldquote = 'e', data_compression = 'gzip', parser_version = '1.0', header_row = TRUE, datafiletype = 'widechar', codepage = 'ACP', rowset_options = '{  "READ_OPTIONS"  :["ALLOW_INCONSISTENT_READS" ]  }  ') with ([region] varchar(100)) as a;
select * from openrowset (bulk 'f1', format = 'CSV') with ([region] varchar(100) 1, [continent] varchar(100) collate latin1_general_bin2 2, [products] varchar(100) 3, [status] int 4) as a;
select * from openrowset (bulk 'f1', format = 'CSV', fieldterminator = 'aa', rowterminator = 'bb', escapechar = 'd', firstrow = 1, fieldquote = 'e', data_compression = 'gzip', parser_version = '1.0', header_row = TRUE, datafiletype = 'widechar', codepage = 'ACP', rowset_options = '
{ 
"READ_OPTIONS"  
:
[           "ALLOW_INCONSISTENT_READS"] 

  } 
') with ([region] varchar(100)) as a;
select * from openrowset (bulk 'f2', format = 'CSV', fieldterminator = 'x', rowterminator = 'y', escapechar = 'z', firstrow = 1, fieldquote = 'e', data_compression = 'gzip', parser_version = '2.0', header_row = TRUE, datafiletype = 'widechar', codepage = 'ACP', rowset_options = '
{ 
"read_options":
[           "ALLOW_INCONSISTENT_reads"         ] 

  } 
') with ([region] varchar(100)) as a;
