-- <db_state_option>
alter database d1 set online, offline with no_wait

-- <db_user_access_option>
alter database d1 set single_user with rollback after 10
alter database d1 set restricted_user, multi_user with rollback after 10 seconds

alter database d1 set read_only with rollback immediate
alter database d1 set read_write

-- <cursor_option>
alter database d1 set cursor_close_on_commit on
alter database d1 set cursor_close_on_commit off, cursor_default local
alter database d1 set cursor_default global

-- <auto_option>
alter database d1 set auto_close on, auto_create_statistics off, auto_shrink on
alter database d1 set auto_update_statistics on

-- <sql_option>
alter database d1 set ANSI_NULL_DEFAULT on, ansi_nulls off, ansi_padding on
alter database d1 set ansi_warnings off, arithabort on, concat_null_yields_null off
alter database d1 set numeric_roundabort on, quoted_identifier off, recursive_triggers on

-- <recovery_option>
alter database d1 set recovery full, torn_page_detection off
alter database d1 set torn_page_detection on, recovery bulk_logged
alter database d1 set recovery simple
