/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlResultSet, SqlValue } from "../../../common/sqlReader";
import { QueryStoreMetric, dbNamesToMetricMapping } from "./metric";
import { ReplicaGroup, replicaGroupIds } from "./replicaGroup";
import { formatBigInt } from "./sqlParameters";

/**
 * Finds the metrics that the server records. The first result set has the columns of
 * `sys.query_store_runtime_stats`, which change between versions. The second has one row that is
 * 1 when `sys.query_store_wait_stats` exists. The text is the C#
 * `QdsMetadataMapper.GetAvailableMetricNamesFromDb` query. Map the result with
 * {@link mapAvailableMetrics}.
 */
export const availableMetricsProbeQuery =
    "select top(1) * from sys.query_store_runtime_stats;" +
    "IF OBJECT_ID ('sys.query_store_wait_stats') IS NOT NULL SELECT CAST(1 as bit) AS result ELSE SELECT CAST(0 as bit) AS result;";

/** The name the C# code adds for wait stats. It is the `waitTime` database column name. */
const waitStatsColumnName = "wait_stats_id";

/**
 * Maps the result sets of {@link availableMetricsProbeQuery} to metrics. The reader must return
 * the column names of the first result set even when it has no rows.
 */
export function mapAvailableMetrics(resultSets: readonly SqlResultSet[]): QueryStoreMetric[] {
    const names = [...(resultSets[0]?.columns ?? [])];
    // Like the C# code, read the first row of each later result set, and stop at an empty one.
    for (const resultSet of resultSets.slice(1)) {
        const row = resultSet.rows[0];
        if (!row) {
            break;
        }
        if (isTrue(row[0])) {
            names.push(waitStatsColumnName);
        }
    }
    return mapDbNamesToAvailableMetrics(names);
}

/**
 * Maps database column names to metrics, in the order of the names, without duplicates. Names
 * that are not metrics are ignored. Throws an `Error` when there are no names. C#
 * `QdsMetadataMapper.MapDbNamesToAvailableMetrics`.
 */
export function mapDbNamesToAvailableMetrics(names: readonly string[]): QueryStoreMetric[] {
    if (names.length === 0) {
        throw new Error("The database has no Query Store metrics.");
    }
    const mapping = dbNamesToMetricMapping();
    const metrics = new Set<QueryStoreMetric>();
    for (const name of names) {
        const metric = mapping.get(name);
        if (metric !== undefined) {
            metrics.add(metric);
        }
    }
    return [...metrics];
}

function isTrue(value: SqlValue | undefined): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    if (typeof value === "string") {
        const text = value.trim().toLowerCase();
        return text === "1" || text === "true";
    }
    return false;
}

/**
 * Returns 1 in `ReplicaColumnExists` when `sys.query_store_runtime_stats` has a
 * `replica_group_id` column, that is, when the server has Query Store for secondary replicas. Set
 * `isQdsRoAvailable` from it. The text is the C# `Utils.CheckIfQDSROAvailable` query. Map the
 * result with {@link mapReplicaGroupColumnProbe}.
 */
export const replicaGroupColumnProbeQuery = [
    "",
    "SELECT CASE WHEN EXISTS(",
    "SELECT TOP 1 (1)",
    "FROM sys.all_columns c",
    "    JOIN sys.all_objects o",
    "    ON c.object_id = o.object_id",
    "WHERE",
    "    c.name = 'replica_group_id'",
    "    AND o.name = 'query_store_runtime_stats'",
    "    AND o.schema_id = SCHEMA_ID('sys')",
    "    AND o.is_ms_shipped = 1)",
    "THEN 1 ELSE 0 END as ReplicaColumnExists;",
].join("\n");

/** True when the first row of the probe result is 1. False when there is no row. */
export function mapReplicaGroupColumnProbe(resultSets: readonly SqlResultSet[]): boolean {
    const row = resultSets[0]?.rows[0];
    return row !== undefined && isTrue(row[0]);
}

/**
 * Returns the number of rows in `sys.query_store_replicas`, and then the replicas that have
 * runtime stats. The text is the C# `QdsMetadataMapper.GetAvailableReplicas` query, with its
 * indentation. Map the result with {@link mapAvailableReplicas}.
 */
export const availableReplicasQuery = [
    "",
    "                        SELECT COUNT(*) AS ReplicaCount FROM sys.query_store_replicas;",
    "                        SELECT r.replica_name, r.replica_group_id  ",
    "                        FROM sys.query_store_replicas r",
    "                        WHERE EXISTS (",
    "                            SELECT 1",
    "                            FROM sys.query_store_runtime_stats s",
    "                            WHERE s.replica_group_id = r.replica_group_id);",
].join("\n");

/** A replica that a report can show. C# `ReplicaGroupItem`. */
export interface ReplicaGroupItem {
    /** A decimal string. */
    readonly replicaGroupId: string;
    /** The name in `sys.query_store_replicas`, or the replica group code for a default item. */
    readonly replicaName: string;
}

const defaultReplicaNames: Readonly<Record<ReplicaGroup, string>> = {
    primary: "Primary",
    secondary: "Secondary",
    geoSecondary: "GeoSecondary",
    geoHASecondary: "GeoHASecondary",
};

/**
 * Maps the result sets of {@link availableReplicasQuery} to replicas, like the C#
 * `QdsMetadataMapper.GetAvailableReplicas`: the four replica groups when
 * `sys.query_store_replicas` is empty, or else the replicas that have runtime stats. It stops at
 * the first row with an empty name or a negative ID, because the C# code catches the exception of
 * that row. The primary replica is always first when no row has its ID. The default names are the
 * C# enum names, which are not localized.
 */
export function mapAvailableReplicas(resultSets: readonly SqlResultSet[]): ReplicaGroupItem[] {
    const replicas: ReplicaGroupItem[] = [];
    const replicaCount = resultSets[0]?.rows[0]?.[0];
    if (replicaCount !== undefined && Number(replicaCount) === 0) {
        for (const group of Object.keys(defaultReplicaNames) as ReplicaGroup[]) {
            replicas.push({
                replicaGroupId: String(replicaGroupIds[group]),
                replicaName: defaultReplicaNames[group],
            });
        }
    }
    for (const row of resultSets[1]?.rows ?? []) {
        const replicaName = row[0];
        let replicaGroupId: string;
        try {
            replicaGroupId = formatBigInt(row[1] as string | number);
        } catch {
            break;
        }
        if (
            typeof replicaName !== "string" ||
            replicaName === "" ||
            replicaGroupId.startsWith("-")
        ) {
            break;
        }
        replicas.push({ replicaGroupId, replicaName });
    }

    const primaryId = String(replicaGroupIds.primary);
    if (!replicas.some((replica) => replica.replicaGroupId === primaryId)) {
        replicas.unshift({ replicaGroupId: primaryId, replicaName: defaultReplicaNames.primary });
    }
    return replicas;
}
