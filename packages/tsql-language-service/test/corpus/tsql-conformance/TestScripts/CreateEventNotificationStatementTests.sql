-- sacaglar: Comments inline.

-- basic versions
CREATE EVENT NOTIFICATION log_ddl1 
ON SERVER 
FOR Object_Created
TO SERVICE 'NotifyService', '8140' ;
    
CREATE EVENT NOTIFICATION [log_ddl1]
ON Database With Fan_in
FOR Alter_table, Object_Created 
TO SERVICE 'NotifyService', '123' ;
    
CREATE EVENT NOTIFICATION log_ddl1 
ON queue [myQueue]
FOR Object_Created 
TO SERVICE 'NotifyService',
    '8140a771-3c4b-4479-8ac0-81008ab17984' ;

CREATE EVENT NOTIFICATION log_ddl1 
ON SERVER 
FOR Create_Application_Role, Alter_Application_Role, Drop_Application_Role, Create_Assembly,
Alter_Assembly, Drop_Assembly, Alter_Authorization_Database, Create_Certificate,
Alter_Certificate, Drop_Certificate, Create_Contract, Drop_Contract, Grant_Database,
Deny_Database, Revoke_Database, Create_Event_Notification, Drop_Event_Notification,
Create_Function, Alter_Function, Drop_Function, Create_Index, Alter_Index, Drop_Index,
Create_Message_Type, Alter_Message_Type, Drop_Message_Type, Create_Partition_Function,
Alter_Partition_Function, Drop_Partition_Function, Create_Partition_Scheme,
Alter_Partition_Scheme, Drop_Partition_Scheme, Create_Procedure, Alter_Procedure, Drop_Procedure,
Create_Queue, Alter_Queue, Drop_Queue, Create_Remote_Service_Binding,
Alter_Remote_Service_Binding, Drop_Remote_Service_Binding, Create_Role, Alter_Role, Drop_Role,
Create_Route, Alter_Route, Drop_Route, Create_Schema, Alter_Schema, Drop_Schema, Create_Service,
Alter_Service, Drop_Service, Create_Statistics, Drop_Statistics, Update_Statistics,
Create_Synonym, Drop_Synonym, Create_Table, Alter_Table, Drop_Table, Create_Trigger,
Alter_Trigger, Drop_Trigger, Create_Type, Drop_Type, Create_User, Alter_User, Drop_User,
Create_View, Alter_View, Drop_View, Create_Xml_Schema_Collection, Alter_Xml_Schema_Collection,
Drop_Xml_Schema_Collection, Alter_Authorization_Server, Create_Database, Alter_Database,
Drop_Database, Create_Endpoint, Drop_Endpoint, Alter_Endpoint, Create_Login, Alter_Login,
Drop_Login, Grant_Server, Deny_Server, Revoke_Server, Add_Role_Member, Add_Server_Role_Member,
Drop_Role_Member, Drop_Server_Role_Member, Create_Xml_Index, Queue_Activation,
Broker_Queue_Disabled, Assembly_Load, Audit_Add_Db_User_Event, Audit_AddLogin_Event,
Audit_Add_Login_To_Server_Role_Event, Audit_Add_Member_To_Db_Role_Event, Audit_Add_Role_Event,
Audit_App_Role_Change_Password_Event, Audit_Backup_Restore_Event, Audit_Change_Audit_Event,
Audit_Change_Database_Owner, Audit_Database_Management_Event, Audit_Database_Object_Access_Event,
Audit_Database_Object_Gdr_Event, Audit_Database_Object_Management_Event,
Audit_Database_Object_Take_Ownership_Event, Audit_Database_Operation_Event,
Audit_Database_Principal_Impersonation_Event, Audit_Database_Principal_Management_Event,
Audit_Database_Scope_Gdr_Event, Audit_Dbcc_Event, Audit_Login, Audit_Login_Change_Password_Event,
Audit_Login_Change_Property_Event, Audit_Login_Failed, Audit_Login_Gdr_Event, Audit_Logout,
Audit_Schema_Object_Access_Event, Audit_Schema_Object_Gdr_Event,
Audit_Schema_Object_Management_Event, Audit_Schema_Object_Take_Ownership_Event,
Audit_Server_Alter_Trace_Event, Audit_Server_Object_Gdr_Event,
Audit_Server_Object_Management_Event, Audit_Server_Object_Take_Ownership_Event,
Audit_Server_Operation_Event, Audit_Server_Principal_Impersonation_Event,
Audit_Server_Principal_Management_Event, Audit_Server_Scope_Gdr_Event, Blocked_Process_Report,
Data_File_Auto_Grow, Data_File_Auto_Shrink, Database_Mirroring_State_Change, Deadlock_Graph,
Deprecation_Announcement, Deprecation_Final_Support, Errorlog, Eventlog,
Exception,Exchange_Spill_Event, Execution_Warnings, Ft_Crawl_Aborted, Ft_Crawl_Started,
Ft_Crawl_Stopped, Hash_Warning, Lock_Deadlock, Lock_Deadlock_Chain, Lock_Escalation,
Log_File_Auto_Grow, Log_File_Auto_Shrink, Missing_Column_Statistics, Missing_Join_Predicate,
Mount_Tape, Object_Altered, Object_Created, Object_Deleted, Oledb_Call_Event,
Oledb_Dataread_Event, Oledb_Errors, Oledb_Provider_Information, Oledb_Queryinterface_Event,
Qn__Dynamics, Qn__Parameter_Table, Qn__Subscription, Qn__Template, Server_Memory_Change,
Showplan_All_For_Query_Compile, Showplan_Xml_For_Query_Compile, Showplan_Xml,
Showplan_Xml_Statistics_Profile, Sort_Warnings, Sp_Cacheinsert, Sp_Cachemiss, Sp_Cacheremove,
Sp_Recompile, Sql_Stmtrecompile, Trace_File_Close, User_Error_Message, Userconfigurable_0,
Userconfigurable_1, Userconfigurable_2, Userconfigurable_3, Userconfigurable_4,
Userconfigurable_5, Userconfigurable_6, Userconfigurable_7, Userconfigurable_8,
Userconfigurable_9, Xquery_Static_Type
TO SERVICE 'NotifyService', '8140' ;

CREATE EVENT NOTIFICATION log_ddl1 
ON SERVER 
FOR Ddl_Application_Role_Events, Ddl_Assembly_Events, Ddl_Authorization_Database_Events,
Ddl_Authorization_Server_Events, Ddl_Certificate_Events, Ddl_Contract_Events,
Ddl_Database_Level_Events, Ddl_Database_Security_Events, Ddl_Endpoint_Events,
Ddl_Event_Notification_Events, Ddl_Function_Events, Ddl_Gdr_Database_Events,
Ddl_Gdr_Server_Events, Ddl_Index_Events, Ddl_Login_Events, Ddl_Message_Type_Events,
Ddl_Partition_Events, Ddl_Partition_Function_Events, Ddl_Partition_Scheme_Events,
Ddl_Procedure_Events, Ddl_Queue_Events, Ddl_Remote_Service_Binding_Events, Ddl_Role_Events,
Ddl_Route_Events, Ddl_Schema_Events, Ddl_Server_Level_Events, Ddl_Server_Security_Events,
Ddl_Service_Events, Ddl_Ssb_Events, Ddl_Statistics_Events, Ddl_Synonym_Events, Ddl_Table_Events,
Ddl_Table_View_Events, Ddl_Trigger_Events, Ddl_Type_Events, Ddl_User_Events, Ddl_View_Events,
Ddl_Xml_Schema_Collection_Events, Trc_Clr, Trc_Database, Trc_Deprecation,
Trc_Errors_And_Warnings, Trc_Full_Text, Trc_Locks, Trc_Objects  , Trc_Oledb, Trc_Performance,
Trc_Query_Notifications, Trc_Security_Audit, Trc_Server, Trc_Stored_Procedures, Trc_Tsql,
Trc_User_Configurable 
TO SERVICE 'NotifyService', '8140' ;

-- Bug 341251
CREATE EVENT NOTIFICATION CreateDatabaseNotification
ON SERVER
FOR QN__DYNAMICS, QN__PARAMETER_TABLE, QN__SUBSCRIPTION, QN__TEMPLATE
TO SERVICE 'NotifyService', '8140a771-3c4b-4479-8ac0-81008ab17984' 
