/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServerCapabilities } from "../../core/platform";

export type DmvCollectorReadinessStatus = "ready" | "unsupported" | "denied" | "unknown" | "failed";
export type DmvReadinessStatus = DmvCollectorReadinessStatus | "partial";

export interface DmvCollectorReadiness {
    readonly status: DmvCollectorReadinessStatus;
    readonly permission?: string;
    readonly error?: string;
}

export interface DmvReadiness {
    readonly status: DmvReadinessStatus;
    readonly serverPermission: DmvCollectorReadiness;
    readonly databasePermission: DmvCollectorReadiness;
    readonly collectors: Readonly<Record<string, DmvCollectorReadiness>>;
    readonly error?: string;
}

export const dmvReadinessSql = `
SELECT
    HAS_PERMS_BY_NAME(NULL, 'SERVER', 'VIEW SERVER STATE') AS view_server_state,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DATABASE STATE') AS view_database_state`;

export function dmvReadinessFrom(
    capabilities: ServerCapabilities,
    row?: Readonly<Record<string, unknown>>,
    error?: string,
): DmvReadiness {
    const serverPermission = permission(
        capabilities.hasServerScopedDmvs,
        row?.view_server_state,
        "VIEW SERVER STATE",
    );
    const databasePermission = permission(
        capabilities.hasExecutionDmvs,
        row?.view_database_state,
        "VIEW DATABASE STATE",
    );
    const execution = capabilities.hasExecutionDmvs
        ? capabilities.platform === "azureSqlDatabase" || capabilities.platform === "fabric"
            ? databasePermission
            : serverPermission
        : unsupported();
    const server = capabilities.hasServerScopedDmvs ? serverPermission : unsupported();
    const collectors: Record<string, DmvCollectorReadiness> = {
        overview: execution,
        requests: execution,
        blocking: execution,
        workload: execution,
        waits: server,
        storage: server,
        indexes: execution,
    };
    return {
        status: overallStatus(Object.values(collectors)),
        serverPermission,
        databasePermission,
        collectors,
        ...(error ? { error } : {}),
    };
}

/** Maps a runnable DMV query to the readiness collector it represents. */
export function dmvCollectorForQuery(queryId: string): string | undefined {
    switch (queryId) {
        case "dmv.overview":
            return "overview";
        case "dmv.activeRequests":
        case "dmv.blockingChain":
            return "requests";
        case "dmv.topWorkload":
        case "dmv.topQueriesByDuration":
        case "dmv.topQueriesByCpu":
        case "dmv.topQueriesByReads":
            return "workload";
        case "dmv.waitStats":
        case "dmv.waitStatsAzure":
            return "waits";
        case "dmv.fileIoStalls":
            return "storage";
        case "dmv.missingIndexes":
            return "indexes";
        default:
            return undefined;
    }
}

/** Retains a collector failure without turning its evidence into a successful empty sample. */
export function dmvReadinessWithCollectorFailure(
    readiness: DmvReadiness,
    collectorId: string,
    error: string,
): DmvReadiness {
    const collector = readiness.collectors[collectorId];
    if (!collector) return readiness;
    const collectors = {
        ...readiness.collectors,
        [collectorId]: { ...collector, status: "failed" as const, error },
    };
    return {
        ...readiness,
        status: overallStatus(Object.values(collectors)),
        collectors,
    };
}

function overallStatus(values: readonly DmvCollectorReadiness[]): DmvReadinessStatus {
    const hasReady = values.some((item) => item.status === "ready");
    const hasAttention = values.some(
        (item) => item.status === "denied" || item.status === "unknown" || item.status === "failed",
    );
    if (hasReady && hasAttention) return "partial";
    if (hasReady) return "ready";
    if (values.some((item) => item.status === "failed")) return "failed";
    if (values.some((item) => item.status === "unknown")) return "unknown";
    if (values.some((item) => item.status === "denied")) return "denied";
    return "unsupported";
}

function permission(supported: boolean, value: unknown, name: string): DmvCollectorReadiness {
    if (!supported) return unsupported();
    if (value === true || value === 1) return { status: "ready", permission: name };
    if (value === false || value === 0) return { status: "denied", permission: name };
    return { status: "unknown", permission: name };
}

function unsupported(): DmvCollectorReadiness {
    return { status: "unsupported" };
}
