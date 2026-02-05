/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    EngineType,
    ProfilerConfig,
    TEMPLATE_ID_STANDARD_ONPREM,
    TEMPLATE_ID_STANDARD_AZURE,
    TEMPLATE_ID_TSQL_ONPREM,
    TEMPLATE_ID_TSQL_AZURE,
    TEMPLATE_ID_TSQL_LOCKS_ONPREM,
    TEMPLATE_ID_TSQL_DURATION_ONPREM,
    VIEW_ID_STANDARD,
    VIEW_ID_TSQL,
    VIEW_ID_TUNING,
    VIEW_ID_TSQL_LOCKS,
    VIEW_ID_TSQL_DURATION,
} from "./profilerTypes";

/**
 * Default profiler configuration with templates and views
 * Based on Azure Data Studio profiler configuration
 */
export const defaultProfilerConfig: ProfilerConfig = {
    views: [
        {
            id: VIEW_ID_STANDARD,
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
                    eventsMapped: ["client_pid"],
                },
                { field: "SPID", header: "SPID", width: 150, eventsMapped: ["session_id"] },
                {
                    field: "StartTime",
                    header: "StartTime",
                    width: 150,
                    eventsMapped: ["timestamp"],
                },
                { field: "CPU", header: "CPU", width: 150, eventsMapped: ["cpu_time"] },
                { field: "Reads", header: "Reads", width: 150, eventsMapped: ["logical_reads"] },
                { field: "Writes", header: "Writes", width: 150, eventsMapped: ["writes"] },
                { field: "Duration", header: "Duration", width: 150, eventsMapped: ["duration"] },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
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
        {
            id: VIEW_ID_TSQL,
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
                { field: "SPID", header: "SPID", width: 150, eventsMapped: ["session_id"] },
                {
                    field: "StartTime",
                    header: "StartTime",
                    width: 150,
                    eventsMapped: ["timestamp"],
                },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
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
        {
            id: VIEW_ID_TUNING,
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
                { field: "Duration", header: "Duration", width: 150, eventsMapped: ["duration"] },
                { field: "SPID", header: "SPID", width: 150, eventsMapped: ["session_id"] },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
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
        {
            id: VIEW_ID_TSQL_LOCKS,
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
                    eventsMapped: ["client_pid"],
                },
                { field: "SPID", header: "SPID", width: 150, eventsMapped: ["session_id"] },
                {
                    field: "StartTime",
                    header: "StartTime",
                    width: 150,
                    eventsMapped: ["timestamp"],
                },
                { field: "CPU", header: "CPU", width: 150, eventsMapped: ["cpu_time"] },
                { field: "Reads", header: "Reads", width: 150, eventsMapped: ["logical_reads"] },
                { field: "Writes", header: "Writes", width: 150, eventsMapped: ["writes"] },
                { field: "Duration", header: "Duration", width: 150, eventsMapped: ["duration"] },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
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
        {
            id: VIEW_ID_TSQL_DURATION,
            name: "TSQL_Duration View",
            columns: [
                {
                    field: "EventClass",
                    header: "EventClass",
                    width: 150,
                    eventsMapped: ["eventClass", "name"],
                },
                { field: "Duration", header: "Duration", width: 150, eventsMapped: ["duration"] },
                {
                    field: "TextData",
                    header: "TextData",
                    width: 150,
                    eventsMapped: ["options_text", "batch_text", "statement"],
                },
                { field: "SPID", header: "SPID", width: 150, eventsMapped: ["session_id"] },
                {
                    field: "DatabaseID",
                    header: "DatabaseID",
                    width: 150,
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
    ],
    templates: [
        {
            id: TEMPLATE_ID_STANDARD_ONPREM,
            name: "Standard (default)",
            description: "Standard profiling template for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: VIEW_ID_STANDARD,
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
        {
            id: TEMPLATE_ID_STANDARD_AZURE,
            name: "Standard (default)",
            description: "Standard profiling template for Azure SQL Database",
            engineType: EngineType.AzureSQLDB,
            defaultView: VIEW_ID_STANDARD,
            eventsCaptured: [
                "sql_batch_completed",
                "sql_batch_starting",
                "rpc_starting",
                "rpc_completed",
                "attention",
                "existing_connection",
                "login",
                "logout",
            ],
            createStatement: `CREATE EVENT SESSION [{sessionName}] ON DATABASE
ADD EVENT sqlserver.attention(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.existing_connection(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.server_principal_name,sqlserver.session_id)),
ADD EVENT sqlserver.login(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.logout(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.rpc_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.rpc_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0))))
ADD TARGET package0.ring_buffer(SET max_memory=(25600))
WITH (MAX_MEMORY=4096 KB,EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,MAX_DISPATCH_LATENCY=5 SECONDS,MAX_EVENT_SIZE=0 KB,MEMORY_PARTITION_MODE=NONE,TRACK_CAUSALITY=ON,STARTUP_STATE=OFF)`,
        },
        {
            id: TEMPLATE_ID_TSQL_ONPREM,
            name: "TSQL",
            description: "TSQL profiling template for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: VIEW_ID_TSQL,
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
        {
            id: TEMPLATE_ID_TSQL_AZURE,
            name: "TSQL",
            description: "TSQL profiling template for Azure SQL Database",
            engineType: EngineType.AzureSQLDB,
            defaultView: VIEW_ID_TSQL,
            eventsCaptured: [
                "sql_batch_completed",
                "sql_batch_starting",
                "existing_connection",
                "login",
                "logout",
            ],
            createStatement: `CREATE EVENT SESSION [{sessionName}] ON DATABASE
ADD EVENT sqlserver.existing_connection(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.server_principal_name,sqlserver.session_id)),
ADD EVENT sqlserver.login(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.logout(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_name,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_completed(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0)))),
ADD EVENT sqlserver.sql_batch_starting(
    ACTION(package0.event_sequence,sqlserver.client_app_name,sqlserver.client_pid,sqlserver.database_id,sqlserver.database_name,sqlserver.query_hash,sqlserver.server_principal_name,sqlserver.session_id)
    WHERE ([package0].[equal_boolean]([sqlserver].[is_system],(0))))
ADD TARGET package0.ring_buffer(SET max_memory=(25600))
WITH (MAX_MEMORY=4096 KB,EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,MAX_DISPATCH_LATENCY=5 SECONDS,MAX_EVENT_SIZE=0 KB,MEMORY_PARTITION_MODE=NONE,TRACK_CAUSALITY=ON,STARTUP_STATE=OFF)`,
        },
        {
            id: TEMPLATE_ID_TSQL_LOCKS_ONPREM,
            name: "TSQL_Locks",
            description: "TSQL profiling template with lock events for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: VIEW_ID_TSQL_LOCKS,
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
        {
            id: TEMPLATE_ID_TSQL_DURATION_ONPREM,
            name: "TSQL_Duration",
            description: "TSQL profiling template filtering by duration for on-premises SQL Server",
            engineType: EngineType.Standalone,
            defaultView: VIEW_ID_TSQL_DURATION,
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
    ],
};
