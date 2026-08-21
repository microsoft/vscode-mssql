-- Modify filegroup autogrow option
alter database d1 modify filegroup [primary] autogrow_all_files
alter database d1 modify filegroup [primary] autogrow_single_file
alter database d1 modify filegroup fg1 autogrow_all_files
alter database d1 modify filegroup fg1 autogrow_single_file
