-- Smoke tests for new events/event groups added in Katmai

-- event group
CREATE EVENT NOTIFICATION log_ddl1 
ON SERVER 
FOR DDL_CREDENTIAL_EVENTS
TO SERVICE 'NotifyService', '8140' ;
GO

-- event
CREATE EVENT NOTIFICATION log_ddl1 
ON SERVER 
FOR DROP_REMOTE_SERVER
TO SERVICE 'NotifyService', '8140' ;
GO
