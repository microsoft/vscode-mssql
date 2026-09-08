/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServerCapabilities } from "../../core/platform";
import type { QueryStoreReadiness } from "./readiness";

/** A patch: omitted options retain their existing server values. */
export interface QueryStoreConfiguration {
    operationMode?: "READ_WRITE" | "READ_ONLY";
    captureMode?: "AUTO" | "ALL" | "NONE";
    runtimeIntervalMinutes?: number;
    flushIntervalSeconds?: number;
    maxStorageMb?: number;
    retentionDays?: number;
    cleanupMode?: "AUTO" | "OFF";
    waitCaptureMode?: "ON" | "OFF";
}

export function compileQueryStoreConfiguration(
    database: string,
    patch: QueryStoreConfiguration,
    capabilities: ServerCapabilities,
): string {
    const keys = [
        "operationMode",
        "captureMode",
        "runtimeIntervalMinutes",
        "flushIntervalSeconds",
        "maxStorageMb",
        "retentionDays",
        "cleanupMode",
        "waitCaptureMode",
    ];
    if (!patch || Object.keys(patch).some((key) => !keys.includes(key)))
        throw new Error("Unknown Query Store setting.");
    if (
        !capabilities.hasQueryStore ||
        !database ||
        ["master", "tempdb"].includes(database.toLowerCase())
    )
        throw new Error("Unsupported Query Store target.");
    const clauses: string[] = [];
    const enumeration = (
        key: keyof QueryStoreConfiguration,
        sql: string,
        allowed: readonly string[],
    ) => {
        const value = patch[key];
        if (value === undefined) return;
        if (typeof value !== "string" || !allowed.includes(value))
            throw new Error(`Invalid ${key}.`);
        clauses.push(`${sql} = ${value}`);
    };
    const integer = (key: keyof QueryStoreConfiguration, sql: string, min: number, suffix = "") => {
        const value = patch[key];
        if (value === undefined) return;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
            throw new Error(`Invalid ${key}.`);
        clauses.push(`${sql} = ${value}${suffix}`);
    };
    enumeration("operationMode", "OPERATION_MODE", ["READ_WRITE", "READ_ONLY"]);
    enumeration("captureMode", "QUERY_CAPTURE_MODE", ["AUTO", "ALL", "NONE"]);
    if (
        patch.runtimeIntervalMinutes !== undefined &&
        ![1, 5, 10, 15, 30, 60, 1440].includes(patch.runtimeIntervalMinutes)
    )
        throw new Error("Invalid runtimeIntervalMinutes.");
    integer("runtimeIntervalMinutes", "INTERVAL_LENGTH_MINUTES", 1);
    integer("flushIntervalSeconds", "DATA_FLUSH_INTERVAL_SECONDS", 1);
    integer("maxStorageMb", "MAX_STORAGE_SIZE_MB", 1);
    integer("retentionDays", "CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS", 0, ")");
    enumeration("cleanupMode", "SIZE_BASED_CLEANUP_MODE", ["AUTO", "OFF"]);
    if (
        patch.waitCaptureMode !== undefined &&
        capabilities.platform === "sqlServer" &&
        (capabilities.majorVersion ?? 0) < 14
    )
        throw new Error("Wait capture is unavailable on this version.");
    enumeration("waitCaptureMode", "WAIT_STATS_CAPTURE_MODE", ["ON", "OFF"]);
    if (clauses.length === 0) throw new Error("No settings were changed.");
    const operation = patch.operationMode === "READ_WRITE" ? " = ON" : "";
    return `ALTER DATABASE [${database.replace(/]/g, "]]")}] SET QUERY_STORE${operation} (\n    ${clauses.join(",\n    ")}\n);`;
}

export function queryStoreConfigurationMatches(
    state: QueryStoreReadiness | undefined,
    patch: QueryStoreConfiguration,
): boolean {
    if (!state || state.status === "unknown" || state.status === "unsupported") return false;
    return Object.entries(patch).every(
        ([key, value]) =>
            value === undefined ||
            (key === "operationMode"
                ? state.actualState === (value === "READ_WRITE" ? 2 : 1)
                : state[key as keyof QueryStoreReadiness] === value),
    );
}
