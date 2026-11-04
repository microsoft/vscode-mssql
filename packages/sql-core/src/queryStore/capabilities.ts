/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo, detectPlatform } from "../common/platform";
import { sessionPreamble } from "../common/session";
import { SqlReadOptions, SqlReader, readBoolean, toRecords } from "../common/sqlReader";
import { QueryStoreMetric, queryStoreMetrics } from "./metrics";

/**
 * What the server's Query Store has. These facts do not change while a connection is open, so
 * callers read them once with {@link readQueryStoreCapabilities} and pass them to every read.
 */
export interface QueryStoreCapabilities {
    readonly platform: PlatformInfo;
    /**
     * True on SQL Server 2016 and later, Azure SQL Managed Instance, Azure SQL Database, and SQL
     * database in Fabric. Every read gives `unsupported` elsewhere.
     */
    readonly supported: boolean;
    /** The metrics that the runtime stats record. SQL Server 2016 has no log and tempdb metrics. */
    readonly metrics: readonly QueryStoreMetric[];
    /** `sys.query_store_plan.plan_forcing_type_desc`: whether automatic tuning forced a plan. */
    readonly hasPlanForcingType: boolean;
    /** `sys.query_store_plan.plan_type_desc`: dispatcher and variant plans. */
    readonly hasPlanType: boolean;
    /** Query Store for secondary replicas. Reads then count the primary replica only. */
    readonly hasReplicaGroups: boolean;
    /** The custom capture policy settings. */
    readonly hasCapturePolicy: boolean;
    /** The wait statistics capture setting. */
    readonly hasWaitStatsCapture: boolean;
    /** `sys.query_store_wait_stats` has `replica_group_id`. */
    readonly hasWaitStatsReplicaGroups: boolean;
}

const probeQuery = `SELECT
    CASE WHEN COL_LENGTH('sys.query_store_runtime_stats', 'avg_log_bytes_used') IS NULL THEN 0 ELSE 1 END AS has_log_bytes,
    CASE WHEN COL_LENGTH('sys.query_store_runtime_stats', 'avg_tempdb_space_used') IS NULL THEN 0 ELSE 1 END AS has_tempdb,
    CASE WHEN COL_LENGTH('sys.query_store_runtime_stats', 'replica_group_id') IS NULL THEN 0 ELSE 1 END AS has_replica_groups,
    CASE WHEN COL_LENGTH('sys.query_store_plan', 'plan_forcing_type_desc') IS NULL THEN 0 ELSE 1 END AS has_plan_forcing_type,
    CASE WHEN COL_LENGTH('sys.query_store_plan', 'plan_type_desc') IS NULL THEN 0 ELSE 1 END AS has_plan_type,
    CASE WHEN COL_LENGTH('sys.database_query_store_options', 'capture_policy_execution_count') IS NULL THEN 0 ELSE 1 END AS has_capture_policy,
    CASE WHEN COL_LENGTH('sys.database_query_store_options', 'wait_stats_capture_mode') IS NULL THEN 0 ELSE 1 END AS has_wait_stats_capture,
    CASE WHEN COL_LENGTH('sys.query_store_wait_stats', 'replica_group_id') IS NULL THEN 0 ELSE 1 END AS has_wait_replica_groups;`;

/** Detects the platform and reads which Query Store columns the server has. */
export async function readQueryStoreCapabilities(
    reader: SqlReader,
    options?: SqlReadOptions,
): Promise<QueryStoreCapabilities> {
    const platform = await detectPlatform(reader, options);
    if (!hasQueryStore(platform)) {
        return {
            platform,
            supported: false,
            metrics: [],
            hasPlanForcingType: false,
            hasPlanType: false,
            hasReplicaGroups: false,
            hasCapturePolicy: false,
            hasWaitStatsCapture: false,
            hasWaitStatsReplicaGroups: false,
        };
    }
    const [resultSet] = await reader.read(
        `${sessionPreamble(platform, "read")}\n${probeQuery}`,
        options,
    );
    const record = toRecords(resultSet)[0] ?? {};
    const has = (column: string) => readBoolean(record, column) ?? false;
    const hasLogBytes = has("has_log_bytes");
    const hasTempdb = has("has_tempdb");
    return {
        platform,
        supported: true,
        metrics: queryStoreMetrics.filter(
            (metric) =>
                (metric !== "logBytesUsed" || hasLogBytes) &&
                (metric !== "tempdbSpaceUsed" || hasTempdb),
        ),
        hasPlanForcingType: has("has_plan_forcing_type"),
        hasPlanType: has("has_plan_type"),
        hasReplicaGroups: has("has_replica_groups"),
        hasCapturePolicy: has("has_capture_policy"),
        hasWaitStatsCapture: has("has_wait_stats_capture"),
        hasWaitStatsReplicaGroups: has("has_wait_replica_groups"),
    };
}

/** True when the platform has Query Store with runtime statistics for each plan. */
export function hasQueryStore(info: PlatformInfo): boolean {
    switch (info.platform) {
        case "sqlServer":
            return (info.majorVersion ?? 0) >= 13;
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return true;
        default:
            return false;
    }
}
