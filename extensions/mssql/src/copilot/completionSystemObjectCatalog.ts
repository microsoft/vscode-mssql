/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Curated system catalog / DMV surface for the inline-completion schema
 * context, extracted verbatim from the preferredSystemObjects CTE of the
 * completions branch's schema-context query (dev/karlb/completions @
 * 065208582). Scope semantics from that query:
 *   all   — catalog/info-schema objects that are broadly valid when present
 *   broad — SQL Server, Azure SQL DB, and Managed Instance diagnostic surface
 *           (engine editions 2, 3, 4, 5, 8)
 *   full  — SQL Server and Managed Instance only (engine editions 2, 3, 4, 8)
 *
 * Deviation from the query: the per-object sys.all_objects existence probe
 * is dropped (this list is static); an unknown engine edition includes only
 * scope=all entries. masterSymbols stays empty — the query's masterSymbols
 * CTE is WHERE 1=0 on every branch.
 */

export type SystemObjectScope = "all" | "broad" | "full";

export interface CuratedSystemObject {
    schema: string;
    name: string;
    columns: string[];
    scope: SystemObjectScope;
}

export const curatedSystemObjects: readonly CuratedSystemObject[] = [
    {
        schema: "sys",
        name: "dm_exec_requests",
        scope: "broad",
        columns: [
            "session_id",
            "request_id",
            "status",
            "command",
            "database_id",
            "blocking_session_id",
            "wait_type",
            "wait_time",
            "cpu_time",
            "total_elapsed_time",
            "sql_handle",
            "plan_handle",
        ],
    },
    {
        schema: "sys",
        name: "dm_exec_sessions",
        scope: "broad",
        columns: [
            "session_id",
            "login_time",
            "host_name",
            "program_name",
            "login_name",
            "status",
            "database_id",
            "cpu_time",
            "memory_usage",
            "reads",
            "writes",
            "last_request_end_time",
        ],
    },
    {
        schema: "sys",
        name: "dm_exec_connections",
        scope: "broad",
        columns: [
            "session_id",
            "connect_time",
            "net_transport",
            "protocol_type",
            "client_net_address",
            "local_net_address",
            "local_tcp_port",
            "most_recent_sql_handle",
        ],
    },
    {
        schema: "sys",
        name: "dm_exec_query_stats",
        scope: "broad",
        columns: [
            "sql_handle",
            "plan_handle",
            "creation_time",
            "last_execution_time",
            "execution_count",
            "total_worker_time",
            "total_elapsed_time",
            "total_logical_reads",
            "total_logical_writes",
        ],
    },
    {
        schema: "sys",
        name: "dm_exec_sql_text",
        scope: "broad",
        columns: ["sql_handle", "dbid", "objectid", "number", "encrypted", "text"],
    },
    {
        schema: "sys",
        name: "dm_exec_query_plan",
        scope: "broad",
        columns: ["plan_handle", "dbid", "objectid", "number", "encrypted", "query_plan"],
    },
    {
        schema: "sys",
        name: "dm_os_wait_stats",
        scope: "full",
        columns: [
            "wait_type",
            "waiting_tasks_count",
            "wait_time_ms",
            "max_wait_time_ms",
            "signal_wait_time_ms",
        ],
    },
    {
        schema: "sys",
        name: "dm_os_performance_counters",
        scope: "full",
        columns: ["object_name", "counter_name", "instance_name", "cntr_value", "cntr_type"],
    },
    {
        schema: "sys",
        name: "dm_os_memory_clerks",
        scope: "full",
        columns: [
            "type",
            "name",
            "memory_node_id",
            "pages_kb",
            "virtual_memory_reserved_kb",
            "virtual_memory_committed_kb",
        ],
    },
    {
        schema: "sys",
        name: "dm_db_index_usage_stats",
        scope: "broad",
        columns: [
            "database_id",
            "object_id",
            "index_id",
            "user_seeks",
            "user_scans",
            "user_lookups",
            "user_updates",
            "last_user_seek",
            "last_user_scan",
        ],
    },
    {
        schema: "sys",
        name: "dm_db_missing_index_details",
        scope: "broad",
        columns: [
            "index_handle",
            "database_id",
            "object_id",
            "equality_columns",
            "inequality_columns",
            "included_columns",
            "statement",
        ],
    },
    {
        schema: "sys",
        name: "dm_db_index_physical_stats",
        scope: "broad",
        columns: [
            "database_id",
            "object_id",
            "index_id",
            "partition_number",
            "index_type_desc",
            "alloc_unit_type_desc",
            "avg_fragmentation_in_percent",
            "page_count",
        ],
    },
    {
        schema: "sys",
        name: "dm_tran_locks",
        scope: "broad",
        columns: [
            "resource_type",
            "resource_database_id",
            "resource_associated_entity_id",
            "request_mode",
            "request_type",
            "request_status",
            "request_session_id",
        ],
    },
    {
        schema: "sys",
        name: "master_files",
        scope: "full",
        columns: [
            "database_id",
            "file_id",
            "type_desc",
            "name",
            "physical_name",
            "state_desc",
            "size",
            "max_size",
        ],
    },
    {
        schema: "sys",
        name: "server_principals",
        scope: "full",
        columns: [
            "principal_id",
            "name",
            "type_desc",
            "is_disabled",
            "create_date",
            "modify_date",
            "default_database_name",
        ],
    },
    {
        schema: "sys",
        name: "sql_logins",
        scope: "full",
        columns: [
            "principal_id",
            "name",
            "is_disabled",
            "is_policy_checked",
            "is_expiration_checked",
            "default_database_name",
        ],
    },
    {
        schema: "sys",
        name: "server_role_members",
        scope: "full",
        columns: ["role_principal_id", "member_principal_id"],
    },
    {
        schema: "sys",
        name: "endpoints",
        scope: "full",
        columns: [
            "endpoint_id",
            "name",
            "protocol_desc",
            "type_desc",
            "state_desc",
            "is_admin_endpoint",
        ],
    },
    {
        schema: "sys",
        name: "databases",
        scope: "all",
        columns: [
            "database_id",
            "name",
            "state_desc",
            "compatibility_level",
            "collation_name",
            "recovery_model_desc",
            "create_date",
        ],
    },
    {
        schema: "sys",
        name: "objects",
        scope: "all",
        columns: [
            "object_id",
            "name",
            "schema_id",
            "type",
            "type_desc",
            "create_date",
            "modify_date",
        ],
    },
    {
        schema: "sys",
        name: "columns",
        scope: "all",
        columns: [
            "object_id",
            "column_id",
            "name",
            "user_type_id",
            "max_length",
            "precision",
            "scale",
            "is_nullable",
        ],
    },
    {
        schema: "sys",
        name: "tables",
        scope: "all",
        columns: [
            "object_id",
            "name",
            "schema_id",
            "type_desc",
            "create_date",
            "modify_date",
            "is_ms_shipped",
        ],
    },
    {
        schema: "sys",
        name: "views",
        scope: "all",
        columns: [
            "object_id",
            "name",
            "schema_id",
            "type_desc",
            "create_date",
            "modify_date",
            "is_ms_shipped",
        ],
    },
    {
        schema: "sys",
        name: "indexes",
        scope: "all",
        columns: [
            "object_id",
            "index_id",
            "name",
            "type_desc",
            "is_unique",
            "is_primary_key",
            "is_disabled",
        ],
    },
    {
        schema: "sys",
        name: "index_columns",
        scope: "all",
        columns: [
            "object_id",
            "index_id",
            "index_column_id",
            "column_id",
            "key_ordinal",
            "is_included_column",
        ],
    },
    {
        schema: "sys",
        name: "partitions",
        scope: "all",
        columns: [
            "partition_id",
            "object_id",
            "index_id",
            "partition_number",
            "rows",
            "data_compression_desc",
        ],
    },
    {
        schema: "sys",
        name: "allocation_units",
        scope: "all",
        columns: [
            "allocation_unit_id",
            "type_desc",
            "container_id",
            "data_pages",
            "used_pages",
            "total_pages",
        ],
    },
    {
        schema: "sys",
        name: "foreign_keys",
        scope: "all",
        columns: [
            "object_id",
            "name",
            "parent_object_id",
            "referenced_object_id",
            "delete_referential_action_desc",
            "update_referential_action_desc",
        ],
    },
    {
        schema: "sys",
        name: "foreign_key_columns",
        scope: "all",
        columns: [
            "constraint_object_id",
            "constraint_column_id",
            "parent_object_id",
            "parent_column_id",
            "referenced_object_id",
            "referenced_column_id",
        ],
    },
    {
        schema: "sys",
        name: "schemas",
        scope: "all",
        columns: ["schema_id", "name", "principal_id"],
    },
    {
        schema: "sys",
        name: "types",
        scope: "all",
        columns: [
            "user_type_id",
            "system_type_id",
            "name",
            "schema_id",
            "max_length",
            "precision",
            "scale",
            "is_nullable",
        ],
    },
    {
        schema: "sys",
        name: "procedures",
        scope: "all",
        columns: ["object_id", "name", "schema_id", "type_desc", "create_date", "modify_date"],
    },
    {
        schema: "sys",
        name: "parameters",
        scope: "all",
        columns: [
            "object_id",
            "parameter_id",
            "name",
            "user_type_id",
            "max_length",
            "precision",
            "scale",
            "is_output",
        ],
    },
    {
        schema: "INFORMATION_SCHEMA",
        name: "TABLES",
        scope: "all",
        columns: ["TABLE_CATALOG", "TABLE_SCHEMA", "TABLE_NAME", "TABLE_TYPE"],
    },
    {
        schema: "INFORMATION_SCHEMA",
        name: "COLUMNS",
        scope: "all",
        columns: [
            "TABLE_CATALOG",
            "TABLE_SCHEMA",
            "TABLE_NAME",
            "COLUMN_NAME",
            "ORDINAL_POSITION",
            "DATA_TYPE",
            "IS_NULLABLE",
        ],
    },
    {
        schema: "INFORMATION_SCHEMA",
        name: "VIEWS",
        scope: "all",
        columns: ["TABLE_CATALOG", "TABLE_SCHEMA", "TABLE_NAME", "VIEW_DEFINITION"],
    },
    {
        schema: "INFORMATION_SCHEMA",
        name: "ROUTINES",
        scope: "all",
        columns: [
            "SPECIFIC_SCHEMA",
            "SPECIFIC_NAME",
            "ROUTINE_SCHEMA",
            "ROUTINE_NAME",
            "ROUTINE_TYPE",
            "DATA_TYPE",
        ],
    },
];

const broadDmvEngineEditions = new Set([2, 3, 4, 5, 8]);
const fullSurfaceEngineEditions = new Set([2, 3, 4, 8]);

export function selectCuratedSystemObjects(
    engineEdition: number | undefined,
): readonly CuratedSystemObject[] {
    return curatedSystemObjects.filter((object) => {
        switch (object.scope) {
            case "all":
                return true;
            case "broad":
                return engineEdition !== undefined && broadDmvEngineEditions.has(engineEdition);
            case "full":
                return engineEdition !== undefined && fullSurfaceEngineEditions.has(engineEdition);
        }
    });
}

/** Engine-edition display names, from the query's CASE mapping. */
export function engineEditionDisplayName(engineEdition: number | undefined): string | undefined {
    switch (engineEdition) {
        case 2:
            return "SQL Server Standard/Enterprise (or other on-premises edition)";
        case 3:
            return "SQL Server Enterprise";
        case 4:
            return "SQL Server Express";
        case 5:
            return "Azure SQL Database";
        case 6:
            return "Azure Synapse dedicated SQL pool / Fabric Data Warehouse";
        case 8:
            return "Azure SQL Managed Instance";
        case 9:
            return "Azure SQL Edge";
        case 11:
            return "Azure Synapse serverless SQL pool / Microsoft Fabric";
        case 12:
            return "Fabric SQL Database";
        default:
            return engineEdition === undefined
                ? undefined
                : `Unknown engine edition ${engineEdition}`;
    }
}
