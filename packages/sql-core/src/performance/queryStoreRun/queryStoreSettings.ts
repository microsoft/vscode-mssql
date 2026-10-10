/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    PlatformInfo,
    hasQueryStore,
    hasQueryStoreCapturePolicy,
    hasQueryStoreWaitsAndLogMetrics,
} from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import { SqlReader, readNumber, toBooleanValue, toRecords } from "../../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "../result";
import { readOptionsOf } from "../runOptions";
import {
    QueryStoreReadOnlyReason,
    getQueryStoreReadOnlyReason,
} from "../queryStore/common/operationalMode";
import { QueryStoreRunOptions } from "./runContext";

/*
 * The Query Store settings of a database, and the change path for them. The library does not ask
 * for approval. A caller must:
 *
 * 1. call prepareQueryStoreSettingsChange, and show the prepared change (its SQL, the settings
 *    before, blockers, and warnings) to the user;
 * 2. get the user's approval, only when the change has no blockers;
 * 3. call applyQueryStoreSettingsChange, which reads the settings again and refuses the change
 *    if they changed.
 */

/** `actual_state` and `desired_state` of `sys.database_query_store_options`. */
export type QueryStoreState = "off" | "readOnly" | "readWrite" | "error" | "readCapture";

export type QueryStoreCaptureMode = "all" | "auto" | "none" | "custom";

/**
 * The thresholds of the custom capture mode. Query Store captures a query when, in the stale
 * threshold, it reaches any of the other values.
 */
export interface QueryStoreCapturePolicy {
    /** `STALE_CAPTURE_POLICY_THRESHOLD`, from 1 hour to 7 days. */
    readonly staleThresholdHours: number;
    readonly executionCount: number;
    readonly totalCompileCpuTimeMs: number;
    readonly totalExecutionCpuTimeMs: number;
}

export interface QueryStoreSettings {
    readonly actualState: QueryStoreState;
    readonly desiredState: QueryStoreState;
    /** Why Query Store is read-only, when it is. */
    readonly readOnlyReason?: QueryStoreReadOnlyReason;
    readonly currentStorageMb?: number;
    readonly maxStorageMb?: number;
    readonly intervalLengthMinutes?: number;
    /** `stale_query_threshold_days`: how long Query Store keeps the data of a query. */
    readonly staleQueryThresholdDays?: number;
    readonly captureMode?: QueryStoreCaptureMode;
    /** The thresholds of the custom capture mode, where the platform has them. */
    readonly capturePolicy?: QueryStoreCapturePolicy;
    /** `size_based_cleanup_mode`: AUTO removes old queries near the size limit. */
    readonly sizeBasedCleanup?: "auto" | "off";
    /** SQL Server 2017 and later, and the Azure platforms. */
    readonly waitStatsCapture?: "on" | "off";
    readonly maxPlansPerQuery?: number;
    /** How often Query Store writes its data from memory to disk. */
    readonly flushIntervalSeconds?: number;
}

export interface QueryStoreSettingsInfo {
    readonly settings: QueryStoreSettings;
    /** The principal has ALTER on the database, which a change needs. */
    readonly canAlter: boolean;
    /** The platform allows a change of the settings from this library. */
    readonly canChange: boolean;
    /** The platform records wait statistics in Query Store. */
    readonly hasWaitStats: boolean;
    /** The platform has the custom capture policy. */
    readonly hasCapturePolicy: boolean;
    /** The platform allows Query Store to be turned off. Azure SQL Database does not. */
    readonly canTurnOff: boolean;
}

/** Query Store starts size-based cleanup at this percent of the maximum size. */
export const queryStoreCleanupThresholdPercent = 90;

/** The values of `INTERVAL_LENGTH_MINUTES` that SQL Server accepts. */
export const queryStoreIntervalLengths: readonly number[] = [1, 5, 10, 15, 30, 60, 1440];

/** The longest `STALE_CAPTURE_POLICY_THRESHOLD`: 7 days. */
export const queryStoreMaxCaptureStaleHours = 168;

export interface QueryStoreSettingsChange {
    /** Read-write or read-only turns Query Store on when it is off. Off turns it off, alone. */
    readonly operationMode?: "readWrite" | "readOnly" | "off";
    /** Custom sets the capture policy too: the given values, and the current ones for the rest. */
    readonly captureMode?: QueryStoreCaptureMode;
    readonly capturePolicy?: Partial<QueryStoreCapturePolicy>;
    readonly maxStorageMb?: number;
    readonly staleQueryThresholdDays?: number;
    /** One of {@link queryStoreIntervalLengths}. */
    readonly intervalLengthMinutes?: number;
    readonly waitStatsCapture?: "on" | "off";
    readonly sizeBasedCleanup?: "auto" | "off";
    readonly flushIntervalSeconds?: number;
}

export type QueryStoreSettingsBlocker =
    /** No value is different from the current settings. */
    | "noChange"
    | "permissionMissing"
    /** The platform does not allow the change from this library. */
    | "platformUnsupported"
    /** The platform does not record wait statistics in Query Store. */
    | "waitStatsUnsupported"
    /** The platform does not have the custom capture policy. */
    | "capturePolicyUnsupported"
    /** The platform does not allow Query Store to be turned off. */
    | "turnOffUnsupported"
    /** Query Store is in the error state; turn it off and on first. */
    | "queryStoreError"
    /** The settings are not the same as when the change was prepared. */
    | "settingsChanged"
    /** The prepared SQL is not the SQL for the change. */
    | "preparedSqlMismatch";

export type QueryStoreSettingsWarning =
    /** The new maximum size is below the current size, so Query Store becomes read-only. */
    | "maxSizeBelowCurrentSize"
    /** Read-only stops the capture of new queries and statistics. */
    | "readOnlyStopsCapture"
    /** Capture mode NONE stops the capture of new queries. */
    | "captureNoneStopsNewQueries"
    /** Query Store is off; the change turns it on. */
    | "turnsQueryStoreOn"
    /** Off stops the capture, and forced plans are no longer forced. The data stays. */
    | "turnsQueryStoreOff"
    /** Without size-based cleanup, Query Store becomes read-only when it is full. */
    | "sizeBasedCleanupOffCanFill"
    /** A longer flush interval loses more data when the server stops unexpectedly. */
    | "longerFlushIntervalLosesMoreData"
    /** A shorter interval uses more storage. */
    | "shorterIntervalUsesMoreStorage";

export interface PreparedQueryStoreSettingsChange {
    readonly kind: "queryStoreSettings";
    /** Only the values that differ from the current settings. */
    readonly change: QueryStoreSettingsChange;
    /** The exact batch that applyQueryStoreSettingsChange runs: the change preamble and the ALTER. */
    readonly sql: string;
    readonly prior: QueryStoreSettings;
    readonly blockers: readonly QueryStoreSettingsBlocker[];
    readonly warnings: readonly QueryStoreSettingsWarning[];
}

export interface AppliedQueryStoreSettingsChange {
    readonly applied: boolean;
    /** Why the change did not run. Empty when it ran. */
    readonly blockers: readonly QueryStoreSettingsBlocker[];
}

const stateIds: Readonly<Record<number, QueryStoreState>> = {
    0: "off",
    1: "readOnly",
    2: "readWrite",
    3: "error",
    4: "readCapture",
};

const captureModeIds: Readonly<Record<number, QueryStoreCaptureMode>> = {
    1: "all",
    2: "auto",
    3: "none",
    4: "custom",
};

const capturePolicyKeys: readonly (keyof QueryStoreCapturePolicy)[] = [
    "staleThresholdHours",
    "executionCount",
    "totalCompileCpuTimeMs",
    "totalExecutionCpuTimeMs",
];

/**
 * Returns the batch that reads the settings and the ALTER permission. The wait statistics and
 * capture policy columns exist only where Query Store has them. Exported for tests.
 */
export function buildQueryStoreSettingsQuery(info: PlatformInfo): string {
    const waitStats = hasQueryStoreWaitsAndLogMetrics(info) ? ",\n    wait_stats_capture_mode" : "";
    const capturePolicy = hasQueryStoreCapturePolicy(info)
        ? `,
    capture_policy_stale_threshold_hours,
    capture_policy_execution_count,
    capture_policy_total_compile_cpu_time_ms,
    capture_policy_total_execution_cpu_time_ms`
        : "";
    return `${sessionPreamble(info, "read")}
SELECT
    actual_state,
    desired_state,
    readonly_reason,
    current_storage_size_mb,
    max_storage_size_mb,
    flush_interval_seconds,
    interval_length_minutes,
    stale_query_threshold_days,
    size_based_cleanup_mode,
    query_capture_mode,
    max_plans_per_query${waitStats}${capturePolicy}
FROM sys.database_query_store_options;
SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS can_alter;`;
}

/**
 * Reads the Query Store settings of the database. SQL Server 2016 and later, Azure SQL Managed
 * Instance, Azure SQL Database, and SQL database in Fabric; `unsupported` elsewhere. Changes are
 * allowed on SQL Server, Managed Instance, and Azure SQL Database.
 */
export async function readQueryStoreSettings(
    reader: SqlReader,
    info: PlatformInfo,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreSettingsInfo>> {
    const now = options.now ?? new Date();
    if (!hasQueryStore(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const data = await readSettingsInfo(reader, info, options);
        return {
            status: "ready",
            platform: info.platform,
            source: "queryStore",
            scope: "database",
            observedAtUtc: now.toISOString(),
            data,
            missing: [],
        };
    } catch (error) {
        return errorResult(info, error, now, "queryStore");
    }
}

/**
 * Reads the settings and prepares a change that sets the values of `change` that differ from
 * them. Get the user's approval before {@link applyQueryStoreSettingsChange}.
 */
export async function prepareQueryStoreSettingsChange(
    reader: SqlReader,
    info: PlatformInfo,
    change: QueryStoreSettingsChange,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<PreparedQueryStoreSettingsChange>> {
    assertSettingsChange(change);
    const now = options.now ?? new Date();
    if (!hasQueryStore(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const current = await readSettingsInfo(reader, info, options);
        return {
            status: "ready",
            platform: info.platform,
            source: "queryStore",
            scope: "database",
            observedAtUtc: now.toISOString(),
            data: prepareChange(info, current, change),
            missing: [],
        };
    } catch (error) {
        return errorResult(info, error, now, "queryStore");
    }
}

/**
 * Runs a prepared change after the user approved it. It reads the settings again and refuses the
 * change (`applied: false`) when it has blockers now, when the settings changed, or when
 * `prepared.sql` is not the SQL for the change.
 */
export async function applyQueryStoreSettingsChange(
    reader: SqlReader,
    info: PlatformInfo,
    prepared: PreparedQueryStoreSettingsChange,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<AppliedQueryStoreSettingsChange>> {
    if (prepared.kind !== "queryStoreSettings") {
        throw new RangeError(`"${String(prepared.kind)}" is not a Query Store settings change.`);
    }
    assertSettingsChange(prepared.change);
    const now = options.now ?? new Date();
    if (!hasQueryStore(info)) {
        return unsupportedResult(info, now);
    }
    const base = {
        platform: info.platform,
        source: "queryStore",
        scope: "database",
        observedAtUtc: now.toISOString(),
        missing: [],
    } as const;
    try {
        const current = await readSettingsInfo(reader, info, options);
        const refuse = (blockers: QueryStoreSettingsBlocker[]) => ({
            ...base,
            status: "ready" as const,
            data: { applied: false, blockers },
        });
        const again = prepareChange(info, current, prepared.change);
        if (again.blockers.length > 0) {
            return refuse([...again.blockers]);
        }
        if (settingsKey(current.settings) !== settingsKey(prepared.prior)) {
            return refuse(["settingsChanged"]);
        }
        if (again.sql !== prepared.sql) {
            return refuse(["preparedSqlMismatch"]);
        }
        await reader.read(prepared.sql, readOptionsOf(options));
        return { ...base, status: "ready", data: { applied: true, blockers: [] } };
    } catch (error) {
        return errorResult(info, error, now, "queryStore");
    }
}

/**
 * Returns the batch of a change: the change preamble and an `ALTER DATABASE CURRENT SET
 * QUERY_STORE` statement. `turnOn` adds `= ON`. A change to off is `QUERY_STORE = OFF` alone.
 * A custom capture mode needs the whole policy. Exported for tests.
 */
export function buildQueryStoreSettingsSql(
    info: PlatformInfo,
    change: QueryStoreSettingsChange,
    turnOn: boolean,
): string {
    assertSettingsChange(change);
    const preamble = sessionPreamble(info, "change");
    if (change.operationMode === "off") {
        return `${preamble}\nALTER DATABASE CURRENT SET QUERY_STORE = OFF;`;
    }
    const options: string[] = [];
    if (change.operationMode) {
        options.push(
            `OPERATION_MODE = ${change.operationMode === "readWrite" ? "READ_WRITE" : "READ_ONLY"}`,
        );
    }
    if (change.captureMode) {
        options.push(`QUERY_CAPTURE_MODE = ${change.captureMode.toUpperCase()}`);
    }
    if (change.captureMode === "custom") {
        const policy = change.capturePolicy;
        if (!policy || capturePolicyKeys.some((key) => policy[key] === undefined)) {
            throw new RangeError("A custom capture mode needs all the capture policy values.");
        }
        options.push(
            `QUERY_CAPTURE_POLICY = (
        STALE_CAPTURE_POLICY_THRESHOLD = ${policy.staleThresholdHours} HOURS,
        EXECUTION_COUNT = ${policy.executionCount},
        TOTAL_COMPILE_CPU_TIME_MS = ${policy.totalCompileCpuTimeMs},
        TOTAL_EXECUTION_CPU_TIME_MS = ${policy.totalExecutionCpuTimeMs}
    )`,
        );
    }
    if (change.maxStorageMb !== undefined) {
        options.push(`MAX_STORAGE_SIZE_MB = ${change.maxStorageMb}`);
    }
    if (change.sizeBasedCleanup) {
        options.push(
            `SIZE_BASED_CLEANUP_MODE = ${change.sizeBasedCleanup === "auto" ? "AUTO" : "OFF"}`,
        );
    }
    if (change.staleQueryThresholdDays !== undefined) {
        options.push(
            `CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = ${change.staleQueryThresholdDays})`,
        );
    }
    if (change.flushIntervalSeconds !== undefined) {
        options.push(`DATA_FLUSH_INTERVAL_SECONDS = ${change.flushIntervalSeconds}`);
    }
    if (change.intervalLengthMinutes !== undefined) {
        options.push(`INTERVAL_LENGTH_MINUTES = ${change.intervalLengthMinutes}`);
    }
    if (change.waitStatsCapture) {
        options.push(
            `WAIT_STATS_CAPTURE_MODE = ${change.waitStatsCapture === "on" ? "ON" : "OFF"}`,
        );
    }
    const target = turnOn ? "QUERY_STORE = ON" : "QUERY_STORE";
    const list = options.length > 0 ? ` (\n    ${options.join(",\n    ")}\n)` : "";
    return `${preamble}\nALTER DATABASE CURRENT SET ${target}${list};`;
}

async function readSettingsInfo(
    reader: SqlReader,
    info: PlatformInfo,
    options: QueryStoreRunOptions,
): Promise<QueryStoreSettingsInfo> {
    const [settingsSet, permissionSet] = await reader.read(
        buildQueryStoreSettingsQuery(info),
        readOptionsOf(options),
    );
    const record = toRecords(settingsSet)[0];
    const permission = toRecords(permissionSet)[0];
    const hasWaitStats = hasQueryStoreWaitsAndLogMetrics(info);
    const hasCapturePolicy = hasQueryStoreCapturePolicy(info);
    const number = (column: string) => (record ? readNumber(record, column) : undefined);
    const actualState = stateIds[number("actual_state") ?? 0] ?? "off";
    const readOnlyFlags = number("readonly_reason");
    const cleanup = number("size_based_cleanup_mode");
    const waits = hasWaitStats ? number("wait_stats_capture_mode") : undefined;
    const settings: QueryStoreSettings = withValues({
        actualState,
        desiredState: stateIds[number("desired_state") ?? 0] ?? "off",
        readOnlyReason:
            actualState === "readOnly" && readOnlyFlags
                ? getQueryStoreReadOnlyReason(readOnlyFlags)
                : undefined,
        currentStorageMb: number("current_storage_size_mb"),
        maxStorageMb: number("max_storage_size_mb"),
        intervalLengthMinutes: number("interval_length_minutes"),
        staleQueryThresholdDays: number("stale_query_threshold_days"),
        captureMode: captureModeIds[number("query_capture_mode") ?? -1],
        capturePolicy: hasCapturePolicy ? capturePolicyOf(number) : undefined,
        sizeBasedCleanup: cleanup === undefined ? undefined : cleanup === 1 ? "auto" : "off",
        waitStatsCapture: waits === undefined ? undefined : waits === 1 ? "on" : "off",
        maxPlansPerQuery: number("max_plans_per_query"),
        flushIntervalSeconds: number("flush_interval_seconds"),
    });
    return {
        settings,
        canAlter: toBooleanValue(permission?.can_alter) ?? false,
        canChange: canChangeSettings(info),
        hasWaitStats,
        hasCapturePolicy,
        canTurnOff: info.platform !== "azureSqlDatabase",
    };
}

/** The capture policy, when the server returned all of its values. */
function capturePolicyOf(
    number: (column: string) => number | undefined,
): QueryStoreCapturePolicy | undefined {
    const policy = {
        staleThresholdHours: number("capture_policy_stale_threshold_hours"),
        executionCount: number("capture_policy_execution_count"),
        totalCompileCpuTimeMs: number("capture_policy_total_compile_cpu_time_ms"),
        totalExecutionCpuTimeMs: number("capture_policy_total_execution_cpu_time_ms"),
    };
    return capturePolicyKeys.every((key) => policy[key] !== undefined)
        ? (policy as QueryStoreCapturePolicy)
        : undefined;
}

function canChangeSettings(info: PlatformInfo): boolean {
    return (
        info.platform === "sqlServer" ||
        info.platform === "azureSqlManagedInstance" ||
        info.platform === "azureSqlDatabase"
    );
}

function prepareChange(
    info: PlatformInfo,
    current: QueryStoreSettingsInfo,
    requested: QueryStoreSettingsChange,
): PreparedQueryStoreSettingsChange {
    const settings = current.settings;
    const isOff = settings.actualState === "off";
    const differs = <K extends keyof QueryStoreSettingsChange & keyof QueryStoreSettings>(
        key: K,
    ) =>
        requested[key] !== undefined && requested[key] !== settings[key]
            ? requested[key]
            : undefined;

    // The custom policy: the requested values over the current ones. It is part of the change
    // when the mode becomes custom, or when a value of a custom mode changes.
    const policy = mergedPolicy(settings.capturePolicy, requested.capturePolicy);
    const policyChanges =
        !!requested.capturePolicy &&
        capturePolicyKeys.some(
            (key) =>
                requested.capturePolicy?.[key] !== undefined &&
                requested.capturePolicy[key] !== settings.capturePolicy?.[key],
        );
    const toCustom =
        requested.captureMode === "custom" && (settings.captureMode !== "custom" || policyChanges);

    const turnOff = requested.operationMode === "off" && !isOff;
    const change: QueryStoreSettingsChange = turnOff
        ? { operationMode: "off" }
        : withValues({
              operationMode:
                  requested.operationMode &&
                  requested.operationMode !== "off" &&
                  (isOff || requested.operationMode !== settings.actualState)
                      ? requested.operationMode
                      : undefined,
              captureMode: toCustom
                  ? "custom"
                  : requested.captureMode !== "custom"
                    ? differs("captureMode")
                    : undefined,
              capturePolicy: toCustom ? policy : undefined,
              maxStorageMb: differs("maxStorageMb"),
              staleQueryThresholdDays: differs("staleQueryThresholdDays"),
              intervalLengthMinutes: differs("intervalLengthMinutes"),
              waitStatsCapture: differs("waitStatsCapture"),
              sizeBasedCleanup: differs("sizeBasedCleanup"),
              flushIntervalSeconds: differs("flushIntervalSeconds"),
          });

    const blockers: QueryStoreSettingsBlocker[] = [];
    if (Object.keys(change).length === 0) {
        blockers.push("noChange");
    }
    if (!current.canChange) {
        blockers.push("platformUnsupported");
    }
    if (!current.canAlter) {
        blockers.push("permissionMissing");
    }
    if (change.waitStatsCapture && !current.hasWaitStats) {
        blockers.push("waitStatsUnsupported");
    }
    if (change.captureMode === "custom" && (!current.hasCapturePolicy || !change.capturePolicy)) {
        blockers.push("capturePolicyUnsupported");
    }
    if (turnOff && !current.canTurnOff) {
        blockers.push("turnOffUnsupported");
    }
    if (settings.actualState === "error" && !turnOff) {
        blockers.push("queryStoreError");
    }

    const warnings: QueryStoreSettingsWarning[] = [];
    if (turnOff) {
        warnings.push("turnsQueryStoreOff");
    }
    if (isOff && change.operationMode) {
        warnings.push("turnsQueryStoreOn");
    }
    if (change.operationMode === "readOnly") {
        warnings.push("readOnlyStopsCapture");
    }
    if (change.captureMode === "none") {
        warnings.push("captureNoneStopsNewQueries");
    }
    if (
        change.maxStorageMb !== undefined &&
        settings.currentStorageMb !== undefined &&
        change.maxStorageMb < settings.currentStorageMb
    ) {
        warnings.push("maxSizeBelowCurrentSize");
    }
    if (change.sizeBasedCleanup === "off") {
        warnings.push("sizeBasedCleanupOffCanFill");
    }
    if (
        change.flushIntervalSeconds !== undefined &&
        settings.flushIntervalSeconds !== undefined &&
        change.flushIntervalSeconds > settings.flushIntervalSeconds
    ) {
        warnings.push("longerFlushIntervalLosesMoreData");
    }
    if (
        change.intervalLengthMinutes !== undefined &&
        settings.intervalLengthMinutes !== undefined &&
        change.intervalLengthMinutes < settings.intervalLengthMinutes
    ) {
        warnings.push("shorterIntervalUsesMoreStorage");
    }

    // A blocked custom mode has no whole policy, so its SQL leaves the policy out.
    const sqlChange =
        change.captureMode === "custom" && !change.capturePolicy
            ? { ...change, captureMode: undefined }
            : change;
    return {
        kind: "queryStoreSettings",
        change,
        sql: buildQueryStoreSettingsSql(info, sqlChange, isOff && !!change.operationMode),
        prior: settings,
        blockers,
        warnings,
    };
}

/** The requested policy values over the current ones, when that makes a whole policy. */
function mergedPolicy(
    current: QueryStoreCapturePolicy | undefined,
    requested: Partial<QueryStoreCapturePolicy> | undefined,
): QueryStoreCapturePolicy | undefined {
    const policy = { ...current, ...withValues(requested ?? {}) };
    return capturePolicyKeys.every((key) => policy[key] !== undefined)
        ? (policy as QueryStoreCapturePolicy)
        : undefined;
}

/** The values of the settings that a change depends on. Storage size changes all the time. */
function settingsKey(settings: QueryStoreSettings): string {
    return JSON.stringify([
        settings.actualState,
        settings.captureMode ?? "",
        settings.capturePolicy ?? "",
        settings.maxStorageMb ?? "",
        settings.staleQueryThresholdDays ?? "",
        settings.intervalLengthMinutes ?? "",
        settings.waitStatsCapture ?? "",
        settings.sizeBasedCleanup ?? "",
        settings.flushIntervalSeconds ?? "",
    ]);
}

function assertSettingsChange(change: QueryStoreSettingsChange): void {
    if (!change || typeof change !== "object") {
        throw new RangeError("The change must be an object.");
    }
    const { operationMode, captureMode, waitStatsCapture, sizeBasedCleanup } = change;
    if (operationMode !== undefined && !["readWrite", "readOnly", "off"].includes(operationMode)) {
        throw new RangeError(`"${String(operationMode)}" is not an operation mode.`);
    }
    if (captureMode !== undefined && !["all", "auto", "none", "custom"].includes(captureMode)) {
        throw new RangeError(`"${String(captureMode)}" is not a capture mode.`);
    }
    if (waitStatsCapture !== undefined && waitStatsCapture !== "on" && waitStatsCapture !== "off") {
        throw new RangeError(`"${String(waitStatsCapture)}" is not a wait statistics mode.`);
    }
    if (
        sizeBasedCleanup !== undefined &&
        sizeBasedCleanup !== "auto" &&
        sizeBasedCleanup !== "off"
    ) {
        throw new RangeError(`"${String(sizeBasedCleanup)}" is not a size-based cleanup mode.`);
    }
    if (change.capturePolicy !== undefined && typeof change.capturePolicy !== "object") {
        throw new RangeError("The capture policy must be an object.");
    }
    assertWholeNumber(change.maxStorageMb, 1, 2_147_483_647, "maximum size");
    assertWholeNumber(change.staleQueryThresholdDays, 1, 36_500, "stale query threshold");
    assertWholeNumber(change.flushIntervalSeconds, 1, 2_147_483_647, "flush interval");
    const policy = change.capturePolicy ?? {};
    assertWholeNumber(
        policy.staleThresholdHours,
        1,
        queryStoreMaxCaptureStaleHours,
        "capture policy stale threshold",
    );
    assertWholeNumber(policy.executionCount, 1, 2_147_483_647, "capture policy execution count");
    assertWholeNumber(
        policy.totalCompileCpuTimeMs,
        1,
        2_147_483_647,
        "capture policy compile CPU time",
    );
    assertWholeNumber(
        policy.totalExecutionCpuTimeMs,
        1,
        2_147_483_647,
        "capture policy execution CPU time",
    );
    if (
        change.intervalLengthMinutes !== undefined &&
        !queryStoreIntervalLengths.includes(change.intervalLengthMinutes)
    ) {
        throw new RangeError(`${change.intervalLengthMinutes} is not a Query Store interval.`);
    }
}

function assertWholeNumber(value: number | undefined, min: number, max: number, name: string) {
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
        throw new RangeError(`The ${name} must be a whole number from ${min} to ${max}.`);
    }
}

function withValues<T extends object>(values: { [K in keyof T]: T[K] | undefined }): T {
    return Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
    ) as T;
}
