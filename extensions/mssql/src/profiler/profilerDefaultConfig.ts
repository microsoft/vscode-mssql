/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColumnDataType, EngineType, ProfilerConfig } from "./profilerTypes";

/**
 * Default profiler configuration with templates and views
 * Based on Azure Data Studio profiler configuration
 */
export const defaultProfilerConfig: ProfilerConfig = {
    views: {
        "Standard View": {
            id: "Standard View",
            name: "Standard View",
            columns: [
                {
                    field: "EventClass",
                    header: "EventClass",
                    width: 150,
                    eventsMapped: ["eventClass", "name"],
                },
                {
                    field: "TextData",
                    header: "TextData",
                    width: 150,
                    eventsMapped: ["options_text", "batch_text", "statement"],
                },
                {
                    field: "ApplicationName",
                    header: "ApplicationName",
                    width: 150,
                    eventsMapped: ["client_app_name"],
                },
                {
                    field: "NTUserName",
                    header: "NTUserName",
                    width: 150,
                    eventsMapped: ["nt_username"],
                },
                {
                    field: "LoginName",
                    header: "LoginName",
                    width: 150,
                    eventsMapped: ["server_principal_name"],
                },
                {
                    field: "ClientProcessID",
                    header: "ClientProcessID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["client_pid"],
                },
                {
                    field: "SPID",
                    header: "SPID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["session_id"],
                },
                {
                    field: "StartTime",
                    header: "StartTime",
                    width: 150,
                    type: ColumnDataType.DateTime,
                    eventsMapped: ["timestamp"],
                },
                {
                    field: "CPU",
                    header: "CPU",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["cpu_time"],
                },
                {
                    field: "Reads",
                    header: "Reads",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["logical_reads"],
                },
                {
                    field: "Writes",
                    header: "Writes",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["writes"],
                },
                {
                    field: "Duration",
                    header: "Duration",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["duration"],
                },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["database_id"],
                },
                {
                    field: "DatabaseName",
                    header: "DatabaseName",
                    width: 150,
                    eventsMapped: ["database_name"],
                },
                {
                    field: "HostName",
                    header: "HostName",
                    width: 150,
                    eventsMapped: ["client_hostname"],
                },
            ],
        },
        "TSQL View": {
            id: "TSQL View",
            name: "TSQL View",
            columns: [
                {
                    field: "EventClass",
                    header: "EventClass",
                    width: 150,
                    eventsMapped: ["eventClass", "name"],
                },
                {
                    field: "TextData",
                    header: "TextData",
                    width: 150,
                    eventsMapped: ["options_text", "batch_text", "statement"],
                },
                {
                    field: "SPID",
                    header: "SPID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["session_id"],
                },
                {
                    field: "StartTime",
                    header: "StartTime",
                    width: 150,
                    type: ColumnDataType.DateTime,
                    eventsMapped: ["timestamp"],
                },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["database_id"],
                },
                {
                    field: "DatabaseName",
                    header: "DatabaseName",
                    width: 150,
                    eventsMapped: ["database_name"],
                },
                {
                    field: "HostName",
                    header: "HostName",
                    width: 150,
                    eventsMapped: ["client_hostname"],
                },
            ],
        },
        "Tuning View": {
            id: "Tuning View",
            name: "Tuning View",
            columns: [
                {
                    field: "EventClass",
                    header: "EventClass",
                    width: 150,
                    eventsMapped: ["eventClass", "name"],
                },
                {
                    field: "TextData",
                    header: "TextData",
                    width: 150,
                    eventsMapped: ["options_text", "batch_text", "statement"],
                },
                {
                    field: "Duration",
                    header: "Duration",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["duration"],
                },
                {
                    field: "SPID",
                    header: "SPID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["session_id"],
                },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["database_id"],
                },
                {
                    field: "DatabaseName",
                    header: "DatabaseName",
                    width: 150,
                    eventsMapped: ["database_name"],
                },
                {
                    field: "ObjectType",
                    header: "ObjectType",
                    width: 150,
                    eventsMapped: ["object_type", "object_name", "lock_owner_type"],
                },
                {
                    field: "LoginName",
                    header: "LoginName",
                    width: 150,
                    eventsMapped: ["server_principal_name"],
                },
                {
                    field: "HostName",
                    header: "HostName",
                    width: 150,
                    eventsMapped: ["client_hostname"],
                },
            ],
        },
        "TSQL_Locks View": {
            id: "TSQL_Locks View",
            name: "TSQL_Locks View",
            columns: [
                {
                    field: "EventClass",
                    header: "EventClass",
                    width: 150,
                    eventsMapped: ["eventClass", "name"],
                },
                {
                    field: "TextData",
                    header: "TextData",
                    width: 150,
                    eventsMapped: [
                        "options_text",
                        "batch_text",
                        "statement",
                        "resource_description",
                    ],
                },
                {
                    field: "ApplicationName",
                    header: "ApplicationName",
                    width: 150,
                    eventsMapped: ["client_app_name"],
                },
                {
                    field: "NTUserName",
                    header: "NTUserName",
                    width: 150,
                    eventsMapped: ["nt_username"],
                },
                {
                    field: "LoginName",
                    header: "LoginName",
                    width: 150,
                    eventsMapped: ["server_principal_name"],
                },
                {
                    field: "ClientProcessID",
                    header: "ClientProcessID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["client_pid"],
                },
                {
                    field: "SPID",
                    header: "SPID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["session_id"],
                },
                {
                    field: "StartTime",
                    header: "StartTime",
                    width: 150,
                    type: ColumnDataType.DateTime,
                    eventsMapped: ["timestamp"],
                },
                {
                    field: "CPU",
                    header: "CPU",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["cpu_time"],
                },
                {
                    field: "Reads",
                    header: "Reads",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["logical_reads"],
                },
                {
                    field: "Writes",
                    header: "Writes",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["writes"],
                },
                {
                    field: "Duration",
                    header: "Duration",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["duration"],
                },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["database_id"],
                },
                {
                    field: "DatabaseName",
                    header: "DatabaseName",
                    width: 150,
                    eventsMapped: ["database_name"],
                },
                {
                    field: "HostName",
                    header: "HostName",
                    width: 150,
                    eventsMapped: ["client_hostname"],
                },
            ],
        },
        "TSQL_Duration View": {
            id: "TSQL_Duration View",
            name: "TSQL_Duration View",
            columns: [
                {
                    field: "EventClass",
                    header: "EventClass",
                    width: 150,
                    eventsMapped: ["eventClass", "name"],
                },
                {
                    field: "Duration",
                    header: "Duration",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["duration"],
                },
                {
                    field: "TextData",
                    header: "TextData",
                    width: 150,
                    eventsMapped: ["options_text", "batch_text", "statement"],
                },
                {
                    field: "SPID",
                    header: "SPID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["session_id"],
                },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
                    type: ColumnDataType.Number,
                    eventsMapped: ["database_id"],
                },
                {
                    field: "DatabaseName",
                    header: "DatabaseName",
                    width: 150,
                    eventsMapped: ["database_name"],
                },
                {
                    field: "HostName",
                    header: "HostName",
                    width: 150,
                    eventsMapped: ["client_hostname"],
                },
            ],
        },
    },
    templates: {
        Standard_OnPrem: {
            id: "Standard_OnPrem",
            name: "Standard (default)",
            description: "Standard profiling template for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: "Standard View",
            eventsCaptured: [
                "sql_batch_completed",
                "sql_batch_starting",
                "rpc_starting",
                "rpc_completed",
                "sp_statement_starting",
                "sp_statement_completed",
                "attention",
                "existing_connection",
                "login",
                "logout",
            ],
            createStatement: `CREATE EVENT SESSION [{sessionName}] ON SERVER
ADD EVENT sqlserver.attention(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.existing_connection(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_hostname,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)),
ADD EVENT sqlserver.login(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_hostname,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.logout(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.rpc_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.rpc_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sp_statement_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sp_statement_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0))))
ADD TARGET package0.ring_buffer(SET max_memory=(25600))
WITH (MAX_MEMORY=4096 KB,EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,MAX_DISPATCH_LATENCY=5 SECONDS,MAX_EVENT_SIZE=0 KB,MEMORY_PARTITION_MODE=NONE,TRACK_CAUSALITY=ON,STARTUP_STATE=OFF)`,
        },
        Standard_Azure: {
            id: "Standard_Azure",
            name: "Standard (default)",
            description: "Standard profiling template for Azure SQL Database",
            engineType: EngineType.AzureSQLDB,
            defaultView: "Standard View",
            eventsCaptured: [
                "sqlserver.attention",
                "sqlserver.existing_connection",
                "sqlserver.login",
                "sqlserver.logout",
                "sqlserver.rpc_completed",
                "sqlserver.sql_batch_completed",
                "sqlserver.sql_batch_starting",
            ],
            createStatement: `CREATE EVENT SESSION [{sessionName}] ON DATABASE ADD EVENT sqlserver.attention(ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.username,sqlserver.query_hash,sqlserver.session_id,sqlserver.client_hostname) WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))), ADD EVENT sqlserver.existing_connection(SET collect_options_text=(1) ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.username,sqlserver.session_id,sqlserver.client_hostname)), ADD EVENT sqlserver.login(SET collect_options_text=(1) ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.username,sqlserver.session_id,sqlserver.client_hostname)), ADD EVENT sqlserver.logout(ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.username,sqlserver.session_id,sqlserver.client_hostname)), ADD EVENT sqlserver.rpc_completed(ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.username,sqlserver.query_hash,sqlserver.session_id,sqlserver.client_hostname) WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))), ADD EVENT sqlserver.sql_batch_completed(ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.username,sqlserver.query_hash,sqlserver.session_id,sqlserver.client_hostname) WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))), ADD EVENT sqlserver.sql_batch_starting(ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.username,sqlserver.query_hash,sqlserver.session_id,sqlserver.client_hostname) WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))) ADD TARGET package0.ring_buffer(SET max_events_limit=(1000)) WITH (EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,MAX_DISPATCH_LATENCY=5 SECONDS,MAX_EVENT_SIZE=0 KB,MEMORY_PARTITION_MODE=PER_CPU,TRACK_CAUSALITY=ON,STARTUP_STATE=OFF)`,
        },
        TSQL_OnPrem: {
            id: "TSQL_OnPrem",
            name: "TSQL",
            description: "TSQL profiling template for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: "TSQL View",
            eventsCaptured: [
                "sql_batch_completed",
                "sql_batch_starting",
                "existing_connection",
                "login",
                "logout",
            ],
            createStatement: `CREATE EVENT SESSION [{sessionName}] ON SERVER
ADD EVENT sqlserver.existing_connection(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)),
ADD EVENT sqlserver.login(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.logout(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0))))
ADD TARGET package0.ring_buffer(SET max_memory=(25600))
WITH (MAX_MEMORY=4096 KB,EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,MAX_DISPATCH_LATENCY=5 SECONDS,MAX_EVENT_SIZE=0 KB,MEMORY_PARTITION_MODE=NONE,TRACK_CAUSALITY=ON,STARTUP_STATE=OFF)`,
        },
        TSQL_Locks_OnPrem: {
            id: "TSQL_Locks_OnPrem",
            name: "TSQL_Locks",
            description: "TSQL profiling template with lock events for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: "TSQL_Locks View",
            eventsCaptured: [
                "sql_batch_completed",
                "sql_batch_starting",
                "lock_acquired",
                "lock_released",
                "existing_connection",
                "login",
                "logout",
            ],
            createStatement: `CREATE EVENT SESSION [{sessionName}] ON SERVER
ADD EVENT sqlserver.existing_connection(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)),
ADD EVENT sqlserver.lock_acquired(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.lock_released(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.login(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.logout(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0))))
ADD TARGET package0.ring_buffer(SET max_memory=(25600))
WITH (MAX_MEMORY=4096 KB,EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,MAX_DISPATCH_LATENCY=5 SECONDS,MAX_EVENT_SIZE=0 KB,MEMORY_PARTITION_MODE=NONE,TRACK_CAUSALITY=ON,STARTUP_STATE=OFF)`,
        },
        TSQL_Duration_OnPrem: {
            id: "TSQL_Duration_OnPrem",
            name: "TSQL_Duration",
            description: "TSQL profiling template filtering by duration for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: "TSQL_Duration View",
            eventsCaptured: [
                "sql_batch_completed",
                "sql_batch_starting",
                "existing_connection",
                "login",
                "logout",
            ],
            createStatement: `CREATE EVENT SESSION [{sessionName}] ON SERVER
ADD EVENT sqlserver.existing_connection(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)),
ADD EVENT sqlserver.login(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.logout(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.nt_username,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)) AND [duration]>=(1000))),
ADD EVENT sqlserver.sql_batch_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.nt_username,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0))))
ADD TARGET package0.ring_buffer(SET max_memory=(25600))
WITH (MAX_MEMORY=4096 KB,EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,MAX_DISPATCH_LATENCY=5 SECONDS,MAX_EVENT_SIZE=0 KB,MEMORY_PARTITION_MODE=NONE,TRACK_CAUSALITY=ON,STARTUP_STATE=OFF)`,
        },
    },
    viewToSessionMap: {
        "Standard View": ["Standard_OnPrem", "Standard_Azure"],
        "TSQL View": ["TSQL_OnPrem", "TSQL_Duration_OnPrem"],
        "Tuning View": ["Standard_OnPrem", "Standard_Azure"],
        "TSQL_Locks View": ["TSQL_Locks_OnPrem"],
        "TSQL_Duration View": ["TSQL_Duration_OnPrem"],
    },
    sessionToViewMap: {
        Standard_OnPrem: ["Standard View", "Tuning View"],
        Standard_Azure: ["Standard View", "Tuning View"],
        TSQL_OnPrem: ["TSQL View"],
        TSQL_Locks_OnPrem: ["TSQL_Locks View", "TSQL View"],
        TSQL_Duration_OnPrem: ["TSQL_Duration View", "TSQL View"],
    },
};
