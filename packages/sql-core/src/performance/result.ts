/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo, SqlPlatform } from "../common/platform";
import { classifySqlError } from "../common/sqlErrors";
import { SqlReadError } from "../common/sqlReader";

export type PerfStatus =
    /** The data is complete for the request. */
    | "ready"
    /** The source works but has no rows for the request. */
    | "noData"
    /** The principal sees only its own sessions and requests. */
    | "selfOnly"
    /** The platform supports the source, but it is off. */
    | "notConfigured"
    /** The principal does not have the necessary permission. */
    | "permissionMissing"
    /** The platform does not have the source or the requested metric. */
    | "unsupported"
    /** A timeout, throttling, failover, or cancel stopped the read. A retry can succeed. */
    | "temporarilyUnavailable"
    | "failed";

export type PerfSource = "queryStore" | "queryInsights" | "dmv" | "pdwDmv";

export type PerfScope = "instance" | "database" | "pool" | "server" | "item";

/**
 * Codes for data that the result does not include. Callers show localized text for each code.
 */
export type MissingDataCode =
    /** Query Store does not have wait statistics (SQL Server 2016, Synapse). */
    | "queryStoreWaitStats"
    /** Query Store does not have the log and tempdb metrics (SQL Server 2016). */
    | "queryStoreLogAndTempdbMetrics"
    /**
     * Query Store is READ_ONLY, so it does not capture new queries or statistics. The data can be
     * old. `probeQueryStore` returns the reason, for example the size limit.
     */
    | "queryStoreReadOnly"
    /**
     * Query Store has only duration and execution count. Synapse dedicated pools record 0 for CPU,
     * I/O, memory, CLR, DOP, row count, log, and tempdb.
     */
    | "queryStoreResourceMetrics"
    /** The plan change flags of the regressed queries, because the plan read failed. */
    | "regressedPlanChanges"
    | "statementText"
    | "otherUsersRequests"
    | "cpuReadsAndMemory";

export interface PerfError {
    readonly message: string;
    readonly errorNumber?: number;
}

export interface PerfResult<T> {
    readonly status: PerfStatus;
    readonly platform: SqlPlatform;
    readonly source?: PerfSource;
    readonly scope?: PerfScope;
    readonly observedAtUtc: string;
    readonly data?: T;
    readonly missing: readonly MissingDataCode[];
    readonly error?: PerfError;
}

/**
 * Maps a read failure to a status.
 */
export function statusForError(error: unknown): PerfStatus {
    switch (classifySqlError(error)) {
        case "permission":
            return "permissionMissing";
        case "unsupported":
            return "unsupported";
        case "transient":
            return "temporarilyUnavailable";
        default:
            return "failed";
    }
}

export function errorResult<T>(
    info: PlatformInfo,
    error: unknown,
    observedAt: Date,
    source?: PerfSource,
): PerfResult<T> {
    return {
        status: statusForError(error),
        platform: info.platform,
        source,
        observedAtUtc: observedAt.toISOString(),
        missing: [],
        error: {
            message: error instanceof Error ? error.message : String(error),
            errorNumber: error instanceof SqlReadError ? error.errorNumber : undefined,
        },
    };
}

export function unsupportedResult<T>(info: PlatformInfo, observedAt: Date): PerfResult<T> {
    return {
        status: "unsupported",
        platform: info.platform,
        observedAtUtc: observedAt.toISOString(),
        missing: [],
    };
}
