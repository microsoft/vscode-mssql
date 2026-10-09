/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * The library's reads are queries too, so Query Store and Query Insights record them. These
 * patterns find them by the objects and the statements that the library sends. Query Store keeps
 * each statement of a batch as its own query, so the small statements of a batch, such as the
 * permission check, have patterns of their own.
 */

/** A `sys` object name, with or without brackets, for example `sys.query_store_plan`. */
function sysObject(names: string): RegExp {
    return new RegExp(`(?<![\\w@#$])\\[?sys\\]?\\s*\\.\\s*\\[?(?:${names})\\b`, "i");
}

const ownQueryPatterns: readonly RegExp[] = [
    // Query Store reports, probes, settings, and plan forcing.
    sysObject("query_store_\\w+"),
    sysObject("database_query_store_options"),
    /'query_store_runtime_stats'/i,
    /\bsp_query_store_(?:force|unforce)_plan\b/i,
    /\bALTER\s+DATABASE\s+CURRENT\s+SET\s+QUERY_STORE\b/i,
    /\bHAS_PERMS_BY_NAME\s*\(\s*DB_NAME\s*\(\s*\)\s*,\s*'DATABASE'\s*,\s*'ALTER'\s*\)\s*AS\s+can_alter\b/i,
    /\bSYSDATETIMEOFFSET\s*\(\s*\)\s+AS\s+server_time\b/i,
    /@interval_length_minutes\s+AS\s+interval_length_minutes\b/i,
    /\bselect\s+definition\s+from\s+sys\s*\.\s*sql_modules\s+where\s+object_id\s*=\s*@Object_ID\b/i,
    // Live activity, sessions, and the permission check before them.
    sysObject("dm_exec_requests|dm_exec_sessions|dm_exec_connections"),
    sysObject("dm_pdw_exec_requests|dm_pdw_exec_sessions|dm_pdw_waits"),
    /\bHAS_PERMS_BY_NAME\s*\([\s\S]*?'VIEW\s+(?:SERVER|DATABASE)(?:\s+PERFORMANCE)?\s+STATE'\s*\)\s*AS\s+has_permission\b/i,
    // Resources, database facts, and automatic tuning.
    sysObject(
        "dm_db_resource_stats|resource_stats|server_resource_stats|dm_user_db_resource_governance|dm_os_sys_info",
    ),
    sysObject("dm_db_tuning_recommendations|database_automatic_tuning_options"),
    /\bDATABASEPROPERTYEX\s*\(\s*DB_NAME\s*\(\s*\)\s*,\s*N?'ServiceObjective'\s*\)/i,
    // Platform detection and the database list.
    /\bSERVERPROPERTY\s*\(\s*N?'EngineEdition'\s*\)/i,
    /\bdata_lake_log_publishing_desc\b/i,
    /\bSELECT\s+name\s+FROM\s+sys\s*\.\s*databases\s+WHERE\s+state\s*=\s*0\s+ORDER\s+BY\s+name\b/i,
    // Query Insights top queries.
    /(?<![\w@#$])\[?queryinsights\]?\s*\.\s*\[?exec_requests_history\b/i,
];

/**
 * True when a Query Store query text is one of this library's own reads (Query Store views, the
 * DMVs and catalog views that the library reads), so callers can leave it out of query lists. A
 * user query that reads the same views is a monitoring query too, so it is also true for it.
 */
export function isPerformanceToolQuery(queryText: string | undefined): boolean {
    if (typeof queryText !== "string" || queryText.trim() === "") {
        return false;
    }
    return ownQueryPatterns.some((pattern) => pattern.test(queryText));
}
