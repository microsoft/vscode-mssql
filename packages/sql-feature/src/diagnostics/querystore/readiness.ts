/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type QueryStoreStatus =
    | "unsupported"
    | "unknown"
    | "off"
    | "collecting"
    | "readOnly"
    | "readOnlyUnexpected"
    | "error"
    | "secondary";

export type QueryStoreAccess = "notApplicable" | "granted" | "denied" | "inconclusive";

export interface QueryStoreReadiness {
    status: QueryStoreStatus;
    access: QueryStoreAccess;
    actualState?: number;
    desiredState?: number;
    canConfigure?: boolean;
    canReadHistory: boolean;
    readonlyReasons: number[];
    unknownReasonBits: number;
    captureMode?: string;
    cleanupMode?: string;
    currentStorageMb?: number;
    maxStorageMb?: number;
    runtimeIntervalMinutes?: number;
    flushIntervalSeconds?: number;
    retentionDays?: number;
    waitCaptureMode?: string;
    error?: string;
}

const READONLY_REASONS = [1, 2, 4, 8, 65536, 131072, 262144, 524288];

/** Unknown/empty metadata is never interpreted as disabled or healthy. */
export function queryStoreReadiness(
    supported: boolean,
    database: string | undefined,
    row?: Readonly<Record<string, unknown>>,
): QueryStoreReadiness {
    const base: QueryStoreReadiness = {
        status: "unknown",
        access: "inconclusive",
        canReadHistory: false,
        readonlyReasons: [],
        unknownReasonBits: 0,
    };
    if (!supported || ["master", "tempdb"].includes(database?.toLowerCase() ?? "")) {
        return { ...base, status: "unsupported", access: "notApplicable" };
    }
    if (!database || !row) return base;
    const actual = numeric(row.actual_state);
    const desired = numeric(row.desired_state);
    const reasons = numeric(row.readonly_reason) ?? 0;
    const flags = READONLY_REASONS.filter((flag) => (reasons & flag) !== 0);
    const status: QueryStoreStatus =
        row.can_read_history === 0 || row.can_read_history === false
            ? "unknown"
            : actual === 0
              ? "off"
              : actual === 1
                ? desired === 2
                    ? "readOnlyUnexpected"
                    : desired === 1
                      ? "readOnly"
                      : "unknown"
                : actual === 2
                  ? "collecting"
                  : actual === 3
                    ? "error"
                    : actual === 8
                      ? "secondary"
                      : "unknown";
    return {
        ...base,
        status,
        access:
            row.can_read_history === 0 || row.can_read_history === false
                ? "denied"
                : actual === undefined
                  ? "inconclusive"
                  : "granted",
        actualState: actual,
        desiredState: desired,
        canReadHistory:
            row.can_read_history === 0 || row.can_read_history === false
                ? false
                : actual === 1 || actual === 2 || actual === 8,
        canConfigure:
            row.can_configure === 1 || row.can_configure === true
                ? true
                : row.can_configure === 0 || row.can_configure === false
                  ? false
                  : undefined,
        readonlyReasons: flags,
        unknownReasonBits: reasons - flags.reduce((sum, flag) => sum + flag, 0),
        captureMode: text(row.query_capture_mode_desc),
        cleanupMode: text(row.size_based_cleanup_mode_desc),
        waitCaptureMode: text(row.wait_stats_capture_mode_desc),
        currentStorageMb: numeric(row.current_storage_size_mb),
        maxStorageMb: numeric(row.max_storage_size_mb),
        runtimeIntervalMinutes: numeric(row.interval_length_minutes),
        flushIntervalSeconds: numeric(row.flush_interval_seconds),
        retentionDays: numeric(row.stale_query_threshold_days),
    };
}

function numeric(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function text(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
