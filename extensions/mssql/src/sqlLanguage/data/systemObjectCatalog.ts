/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Language-service-owned static system-object catalog. The metadata service
 * hydrates user objects only (is_ms_shipped = 0), so sys/INFORMATION_SCHEMA
 * names never resolve from a live snapshot; this curated data lets the
 * engine resolve the common system surface (member completions, hover,
 * clean 208-tier diagnostics) without a server round trip.
 *
 * SINGLE SOURCE of the curated data: src/copilot/completionSystemObjectCatalog
 * re-exports from here (the data moved from that module because sqlLanguage
 * data/ is import-pure and may not reach into src/copilot). Provenance:
 * extracted verbatim from the preferredSystemObjects CTE of the completions
 * branch's schema-context query (dev/karlb/completions @ 065208582). Scope
 * semantics from that query:
 *   all   — catalog/info-schema objects that are broadly valid when present
 *   broad — SQL Server, Azure SQL DB, and Managed Instance diagnostic surface
 *           (engine editions 2, 3, 4, 5, 8)
 *   full  — SQL Server and Managed Instance only (engine editions 2, 3, 4, 8)
 *
 * Deviation from the query: the per-object sys.all_objects existence probe
 * is dropped (this list is static); an unknown engine edition includes only
 * scope=all entries. masterSymbols stays empty — the query's masterSymbols
 * CTE is WHERE 1=0 on every branch.
 *
 * HONESTY CONTRACT for language-service consumers: the catalog is NOT
 * exhaustive (most system objects are absent) and every column list is a
 * curated SUBSET of the server's real column list. Positive answers
 * ("sys.databases exists", "name is a column of sys.databases") are safe;
 * negative claims ("no such object/column under sys") never are.
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

// ---------------------------------------------------------------------------
// Language-service lookup surface
// ---------------------------------------------------------------------------

/** Schemas the catalog may answer for — it never shadows user schemas. */
export const SYSTEM_SCHEMA_NAMES: readonly string[] = ["sys", "INFORMATION_SCHEMA"];

/**
 * System-schema check. Always case-insensitive: system names are
 * engine-defined and the diagnostics suppression ladder folds them the
 * same way regardless of catalog collation.
 */
export function isSystemSchemaName(name: string): boolean {
    const folded = name.toLowerCase();
    return folded === "sys" || folded === "information_schema";
}

/** A catalog entry addressable through the provider seam's ref space. */
export interface SystemCatalogObject {
    /**
     * NEGATIVE and stable (position in curatedSystemObjects): live catalog
     * object ids are always positive, so the two ref spaces never collide.
     */
    readonly objectId: number;
    readonly schema: string;
    readonly name: string;
    /** Curated column NAMES — a subset, never the full server column list. */
    readonly columns: readonly string[];
}

export function isSystemCatalogObjectId(objectId: number): boolean {
    return objectId < 0;
}

interface SystemCatalogIndex {
    /** Key: `${schema}.${name}` lower-cased. */
    readonly byKey: ReadonlyMap<string, SystemCatalogObject>;
    readonly byId: ReadonlyMap<number, SystemCatalogObject>;
    /** Key: schema lower-cased; values keep data order. */
    readonly bySchema: ReadonlyMap<string, readonly SystemCatalogObject[]>;
}

/** One index per engine edition (the edition gates DMV visibility). */
const indexCache = new Map<number | "unknown", SystemCatalogIndex>();

function indexFor(engineEdition: number | undefined): SystemCatalogIndex {
    const key = engineEdition ?? "unknown";
    const cached = indexCache.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const byKey = new Map<string, SystemCatalogObject>();
    const byId = new Map<number, SystemCatalogObject>();
    const bySchema = new Map<string, SystemCatalogObject[]>();
    const visible = new Set(selectCuratedSystemObjects(engineEdition));
    curatedSystemObjects.forEach((entry, position) => {
        if (!visible.has(entry)) {
            return; // ids stay position-stable across editions
        }
        const object: SystemCatalogObject = {
            objectId: -(position + 1),
            schema: entry.schema,
            name: entry.name,
            columns: entry.columns,
        };
        byKey.set(`${entry.schema}.${entry.name}`.toLowerCase(), object);
        byId.set(object.objectId, object);
        const schemaKey = entry.schema.toLowerCase();
        const list = bySchema.get(schemaKey);
        if (list === undefined) {
            bySchema.set(schemaKey, [object]);
        } else {
            list.push(object);
        }
    });
    const index: SystemCatalogIndex = { byKey, byId, bySchema };
    indexCache.set(key, index);
    return index;
}

/** Does schema.name exist in the curated catalog for this edition? */
export function findSystemObject(
    schema: string,
    name: string,
    engineEdition: number | undefined,
): SystemCatalogObject | undefined {
    if (!isSystemSchemaName(schema)) {
        return undefined;
    }
    return indexFor(engineEdition).byKey.get(`${schema}.${name}`.toLowerCase());
}

export function systemObjectById(
    objectId: number,
    engineEdition: number | undefined,
): SystemCatalogObject | undefined {
    return indexFor(engineEdition).byId.get(objectId);
}

export function systemObjectsInSchema(
    schema: string,
    engineEdition: number | undefined,
): readonly SystemCatalogObject[] {
    return indexFor(engineEdition).bySchema.get(schema.toLowerCase()) ?? [];
}
