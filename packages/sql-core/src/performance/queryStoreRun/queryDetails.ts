/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import {
    SqlReader,
    SqlRecord,
    readBoolean,
    readDateTime,
    readId,
    readNumber,
    readString,
    toRecords,
} from "../../common/sqlReader";
import { MissingDataCode, PerfResult } from "../result";
import { metricConversionFactor } from "../queryStore/common/metric";
import { queryStoreParameters } from "../queryStore/common/queryGeneratorUtils";
import { replicaGroupIds } from "../queryStore/common/replicaGroup";
import { replicaGroupIdParameter } from "../queryStore/common/reportParameters";
import {
    QueryStoreSqlParameter,
    formatBigInt,
    prependSqlParameters,
} from "../queryStore/common/sqlParameters";
import { assertValidDate } from "../queryStore/common/timeInterval";
import { normalizeQueryPlanHash } from "./reportData";
import {
    PlanColumnAvailability,
    QueryStoreFamily,
    QueryStoreRunOptions,
    runWithQueryStore,
} from "./runContext";

/*
 * The reads of a query page. A runtime stats interval counts in the window when its start_time is
 * in [start, end), like runQueryStoreMetricTotals, so an edge of the window can move by up to one
 * interval (one hour by default).
 *
 * Synapse dedicated pools record only duration and execution count. On them, the details and the
 * history leave out the CPU values (the history sets its CPU and read totals to 0) and add
 * `queryStoreResourceMetrics`, and the plans are `unsupported`.
 */

export interface QueryWindowRequest {
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: number | bigint | string;
    readonly start: Date;
    readonly end: Date;
    /** Default 1, the primary. */
    readonly replicaGroupId?: number | bigint | string;
}

export interface QueryDetails {
    readonly queryId: string;
    readonly queryText?: string;
    /** The module that has the query, or absent for ad hoc queries. */
    readonly objectId?: string;
    /** OBJECT_NAME(object_id), or absent for ad hoc queries. */
    readonly objectName?: string;
    /** OBJECT_SCHEMA_NAME(object_id), or absent for ad hoc queries. */
    readonly objectSchemaName?: string;
    /** Last execution of any plan, over all time. ISO 8601 UTC. */
    readonly lastExecutionTime?: string;
    /** The values below are for the window. */
    readonly executionCount: number;
    readonly minDurationMs?: number;
    readonly maxDurationMs?: number;
    readonly avgDurationMs?: number;
    readonly totalDurationMs?: number;
    readonly totalCpuMs?: number;
    /** The plans that ran in the window. */
    readonly planCount: number;
    /** The plans of the query in Query Store, over all time. */
    readonly totalPlanCount?: number;
    /** The forced plan, if a plan of the query is forced. */
    readonly forcedPlanId?: string;
}

/** The runtime stats of the query, or of one of its plans, in a runtime stats interval. */
export interface QueryHistoryStats {
    readonly executionCount: number;
    readonly totalDurationMs: number;
    readonly avgDurationMs?: number;
    readonly minDurationMs?: number;
    readonly maxDurationMs?: number;
    readonly totalCpuMs: number;
    readonly avgCpuMs?: number;
    readonly minCpuMs?: number;
    readonly maxCpuMs?: number;
    /** In 8-KB pages, not converted. */
    readonly totalLogicalReads: number;
    readonly avgLogicalReads?: number;
    readonly minLogicalReads?: number;
    readonly maxLogicalReads?: number;
}

export interface QueryHistoryPlanStats extends QueryHistoryStats {
    readonly planId: string;
}

export interface QueryHistoryInterval extends QueryHistoryStats {
    /** The runtime stats interval, ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
    /** The plans that ran in the interval, ordered by plan ID. The interval values are their totals. */
    readonly plans: readonly QueryHistoryPlanStats[];
}

export interface QueryPlanInfo {
    readonly planId: string;
    /** `0x` hex. Plans with the same hash have the same shape. */
    readonly queryPlanHash?: string;
    /** For a replica group other than the primary, forced on that replica group. */
    readonly isForced: boolean;
    /** From plan_forcing_type_desc when the column exists: "manual" | "auto" | "none". */
    readonly forcingType?: string;
    /** plan_type_desc when the column exists: Compiled Plan, Dispatcher Plan, Query Variant Plan. */
    readonly planType?: string;
    readonly isParallel?: boolean;
    readonly forceFailureCount: number;
    /** `last_force_failure_reason_desc`, for example NONE or NO_INDEX. */
    readonly lastForceFailureReason?: string;
    readonly countCompiles?: number;
    /** ISO 8601 UTC. */
    readonly initialCompileTime?: string;
    readonly lastCompileTime?: string;
    readonly lastExecutionTime?: string;
    /** In the window; 0 when the plan did not run in it. */
    readonly executionCount: number;
    readonly avgDurationMs?: number;
    readonly avgCpuMs?: number;
}

/** A query window with its values checked, for the batch builders. */
export interface ResolvedQueryWindow {
    readonly queryId: string;
    readonly start: Date;
    readonly end: Date;
    readonly replicaGroupId: string;
}

/** noData (data undefined) when the query is not in Query Store. */
export async function runQueryDetails(
    reader: SqlReader,
    info: PlatformInfo,
    request: QueryWindowRequest,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryDetails>> {
    const target = resolveQueryWindow(request);
    return runWithQueryStore<QueryDetails>(
        reader,
        info,
        options,
        { replicaGroupId: target.replicaGroupId },
        async (context) => {
            const [querySet, statsSet] = await context.reader.read(
                `${sessionPreamble(context.info, "read")}\n${buildQueryDetailsQuery(
                    target,
                    context.family,
                    context.probe.isQdsRoAvailable,
                )}`,
                context.readOptions,
            );
            const query = toRecords(querySet)[0];
            if (!query) {
                return { status: "noData" };
            }
            const stats = toRecords(statsSet)[0] ?? {};
            const executionCount = readNumber(stats, "execution_count") ?? 0;
            const totalDurationMs = readNumber(stats, "total_duration_ms");
            const objectId = readId(query, "object_id");
            const data: QueryDetails = withValues({
                queryId: readId(query, "query_id") ?? target.queryId,
                queryText: readString(query, "query_sql_text"),
                objectId: objectId === "0" ? undefined : objectId,
                objectName: readString(query, "object_name"),
                objectSchemaName: readString(query, "object_schema_name"),
                lastExecutionTime: readDateTime(query, "last_execution_time"),
                executionCount,
                minDurationMs: readNumber(stats, "min_duration_ms"),
                maxDurationMs: readNumber(stats, "max_duration_ms"),
                avgDurationMs: average(totalDurationMs, executionCount),
                totalDurationMs,
                totalCpuMs: readNumber(stats, "total_cpu_ms"),
                planCount: readNumber(stats, "plan_count") ?? 0,
                totalPlanCount: readNumber(query, "total_plan_count"),
                forcedPlanId: readId(query, "forced_plan_id"),
            });
            return { status: "ready", data, missing: familyMissing(context.family) };
        },
    );
}

/**
 * One row for each runtime stats interval in the window, in time order: all plans together, and
 * each plan in `plans`.
 */
export async function runQueryExecutionHistory(
    reader: SqlReader,
    info: PlatformInfo,
    request: QueryWindowRequest,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<{ readonly intervals: readonly QueryHistoryInterval[] }>> {
    const target = resolveQueryWindow(request);
    return runWithQueryStore<{ readonly intervals: readonly QueryHistoryInterval[] }>(
        reader,
        info,
        options,
        { replicaGroupId: target.replicaGroupId },
        async (context) => {
            const [resultSet] = await context.reader.read(
                `${sessionPreamble(context.info, "read")}\n${buildQueryExecutionHistoryQuery(
                    target,
                    context.family,
                    context.probe.isQdsRoAvailable,
                )}`,
                context.readOptions,
            );
            const intervals = toHistoryIntervals(toRecords(resultSet));
            return {
                status: intervals.length > 0 ? "ready" : "noData",
                data: { intervals },
                missing: familyMissing(context.family),
            };
        },
    );
}

/**
 * Every plan of the query, with its runs in the window. Ordered by plan_id. `noData` (with an
 * empty list) when Query Store has no plan of the query. `unsupported` on Synapse dedicated pools.
 */
export async function runQueryPlans(
    reader: SqlReader,
    info: PlatformInfo,
    request: QueryWindowRequest,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<{ readonly plans: readonly QueryPlanInfo[] }>> {
    const target = resolveQueryWindow(request);
    return runWithQueryStore<{ readonly plans: readonly QueryPlanInfo[] }>(
        reader,
        info,
        options,
        { replicaGroupId: target.replicaGroupId, planColumns: true, synapseDedicated: false },
        async (context) => {
            const [resultSet] = await context.reader.read(
                `${sessionPreamble(context.info, "read")}\n${buildQueryPlansQuery(
                    target,
                    context.probe.planColumns,
                    context.probe.isQdsRoAvailable,
                )}`,
                context.readOptions,
            );
            const plans = toRecords(resultSet).map(toQueryPlanInfo);
            return { status: plans.length > 0 ? "ready" : "noData", data: { plans } };
        },
    );
}

/** Checks a request. Throws a `RangeError` for an ID or a window that is not valid. */
export function resolveQueryWindow(request: QueryWindowRequest): ResolvedQueryWindow {
    if (!request || typeof request !== "object") {
        throw new RangeError("The request needs a query ID and a window.");
    }
    assertValidDate(request.start);
    assertValidDate(request.end);
    if (request.start.getTime() >= request.end.getTime()) {
        throw new RangeError("The start of the window must be before its end.");
    }
    return {
        queryId: formatBigInt(request.queryId),
        start: request.start,
        end: request.end,
        replicaGroupId: formatBigInt(request.replicaGroupId ?? replicaGroupIds.primary),
    };
}

/**
 * Returns the batch of {@link runQueryDetails}, without the session preamble: the query row, and
 * then the totals of the window. Exported for tests.
 */
export function buildQueryDetailsQuery(
    target: ResolvedQueryWindow,
    family: QueryStoreFamily,
    isQdsRoAvailable: boolean,
): string {
    const ms = metricConversionFactor("duration");
    const forcedPlan =
        family === "synapseDedicated"
            ? "CAST(NULL AS varchar(20))"
            : `(SELECT TOP (1) CONVERT(varchar(20), p.plan_id)
        FROM sys.query_store_plan AS p
        WHERE p.query_id = q.query_id
            AND ${forcedExpression(target)} = 1
        ORDER BY p.plan_id)`;
    const cpu =
        family === "synapseDedicated"
            ? "CAST(NULL AS float)"
            : `CONVERT(float, SUM(rs.avg_cpu_time * rs.count_executions)) * ${ms}`;
    const body = `SELECT
    CONVERT(varchar(20), q.query_id) AS query_id,
    qt.query_sql_text,
    CONVERT(varchar(20), q.object_id) AS object_id,
    CASE WHEN q.object_id = 0 THEN NULL ELSE OBJECT_SCHEMA_NAME(q.object_id) END AS object_schema_name,
    CASE WHEN q.object_id = 0 THEN NULL ELSE OBJECT_NAME(q.object_id) END AS object_name,
    q.last_execution_time,
    (SELECT COUNT(*) FROM sys.query_store_plan AS p WHERE p.query_id = q.query_id) AS total_plan_count,
    ${forcedPlan} AS forced_plan_id
FROM sys.query_store_query AS q
    JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE q.query_id = ${queryStoreParameters.queryId};
SELECT
    SUM(rs.count_executions) AS execution_count,
    COUNT(DISTINCT rs.plan_id) AS plan_count,
    CONVERT(float, MIN(rs.min_duration)) * ${ms} AS min_duration_ms,
    CONVERT(float, MAX(rs.max_duration)) * ${ms} AS max_duration_ms,
    CONVERT(float, SUM(rs.avg_duration * rs.count_executions)) * ${ms} AS total_duration_ms,
    ${cpu} AS total_cpu_ms
${runtimeStatsFrom(isQdsRoAvailable)};`;
    return prependSqlParameters(body, windowParameters(target, isQdsRoAvailable));
}

/** Returns the batch of {@link runQueryExecutionHistory}, without the session preamble. Exported for tests. */
export function buildQueryExecutionHistoryQuery(
    target: ResolvedQueryWindow,
    family: QueryStoreFamily,
    isQdsRoAvailable: boolean,
): string {
    const ms = metricConversionFactor("duration");
    const resourceColumns =
        family === "synapseDedicated"
            ? ""
            : `,
    CONVERT(float, SUM(rs.avg_cpu_time * rs.count_executions)) * ${ms} AS total_cpu_ms,
    CONVERT(float, MIN(rs.min_cpu_time)) * ${ms} AS min_cpu_ms,
    CONVERT(float, MAX(rs.max_cpu_time)) * ${ms} AS max_cpu_ms,
    CONVERT(float, SUM(rs.avg_logical_io_reads * rs.count_executions)) AS total_logical_reads,
    CONVERT(float, MIN(rs.min_logical_io_reads)) AS min_logical_reads,
    CONVERT(float, MAX(rs.max_logical_io_reads)) AS max_logical_reads`;
    const body = `SELECT
    rsi.start_time,
    rsi.end_time,
    CONVERT(varchar(20), rs.plan_id) AS plan_id,
    SUM(rs.count_executions) AS execution_count,
    CONVERT(float, SUM(rs.avg_duration * rs.count_executions)) * ${ms} AS total_duration_ms,
    CONVERT(float, MIN(rs.min_duration)) * ${ms} AS min_duration_ms,
    CONVERT(float, MAX(rs.max_duration)) * ${ms} AS max_duration_ms${resourceColumns}
${runtimeStatsFrom(isQdsRoAvailable)}
GROUP BY rsi.runtime_stats_interval_id, rsi.start_time, rsi.end_time, rs.plan_id
ORDER BY rsi.start_time, rs.plan_id;`;
    return prependSqlParameters(body, windowParameters(target, isQdsRoAvailable));
}

/** Returns the batch of {@link runQueryPlans}, without the session preamble. Exported for tests. */
export function buildQueryPlansQuery(
    target: ResolvedQueryWindow,
    planColumns: PlanColumnAvailability,
    isQdsRoAvailable: boolean,
): string {
    const ms = metricConversionFactor("duration");
    const primary = isPrimary(target);
    const forcingType =
        planColumns.hasPlanForcingType && primary
            ? "p.plan_forcing_type_desc"
            : "CAST(NULL AS nvarchar(60)) AS plan_forcing_type_desc";
    const planType = planColumns.hasPlanType
        ? "p.plan_type_desc"
        : "CAST(NULL AS nvarchar(120)) AS plan_type_desc";
    const replicaFilter = isQdsRoAvailable
        ? `\n            AND rs.replica_group_id = ${queryStoreParameters.replicaGroupId}`
        : "";
    const body = `SELECT
    CONVERT(varchar(20), p.plan_id) AS plan_id,
    CONVERT(varchar(18), p.query_plan_hash, 1) AS query_plan_hash,
    ${forcedExpression(target)} AS is_forced_plan,
    ${forcingType},
    ${planType},
    p.is_parallel_plan,
    p.force_failure_count,
    p.last_force_failure_reason_desc,
    p.count_compiles,
    p.initial_compile_start_time,
    p.last_compile_start_time,
    p.last_execution_time,
    ISNULL(w.execution_count, 0) AS execution_count,
    w.total_duration_ms,
    w.total_cpu_ms
FROM sys.query_store_plan AS p
    LEFT JOIN (
        SELECT
            rs.plan_id,
            SUM(rs.count_executions) AS execution_count,
            CONVERT(float, SUM(rs.avg_duration * rs.count_executions)) * ${ms} AS total_duration_ms,
            CONVERT(float, SUM(rs.avg_cpu_time * rs.count_executions)) * ${ms} AS total_cpu_ms
        FROM sys.query_store_runtime_stats AS rs
            JOIN sys.query_store_runtime_stats_interval AS rsi
                ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
        WHERE rs.plan_id IN (
                SELECT qp.plan_id FROM sys.query_store_plan AS qp
                WHERE qp.query_id = ${queryStoreParameters.queryId})
            AND rsi.start_time >= ${queryStoreParameters.intervalStartTime}
            AND rsi.start_time < ${queryStoreParameters.intervalEndTime}${replicaFilter}
        GROUP BY rs.plan_id
    ) AS w ON w.plan_id = p.plan_id
WHERE p.query_id = ${queryStoreParameters.queryId}
ORDER BY p.plan_id;`;
    return prependSqlParameters(body, windowParameters(target, isQdsRoAvailable));
}

/** The runtime stats of the query's plans in the window. */
function runtimeStatsFrom(isQdsRoAvailable: boolean): string {
    const replicaFilter = isQdsRoAvailable
        ? `\n    AND rs.replica_group_id = ${queryStoreParameters.replicaGroupId}`
        : "";
    return `FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
WHERE p.query_id = ${queryStoreParameters.queryId}
    AND rsi.start_time >= ${queryStoreParameters.intervalStartTime}
    AND rsi.start_time < ${queryStoreParameters.intervalEndTime}${replicaFilter}`;
}

function windowParameters(
    target: ResolvedQueryWindow,
    isQdsRoAvailable: boolean,
): QueryStoreSqlParameter[] {
    const parameters: QueryStoreSqlParameter[] = [
        { name: queryStoreParameters.queryId, type: "bigint", value: target.queryId },
        {
            name: queryStoreParameters.intervalStartTime,
            type: "datetimeoffset",
            value: target.start,
        },
        { name: queryStoreParameters.intervalEndTime, type: "datetimeoffset", value: target.end },
    ];
    // The forcing location of a secondary replica group uses the replica group too.
    if (isQdsRoAvailable || !isPrimary(target)) {
        parameters.push(replicaGroupIdParameter(target.replicaGroupId));
    }
    return parameters;
}

/** `is_forced_plan`, or the forcing location of a secondary replica group. */
function forcedExpression(target: ResolvedQueryWindow): string {
    return isPrimary(target)
        ? "p.is_forced_plan"
        : `CONVERT(bit, CASE WHEN EXISTS (SELECT 1 FROM sys.query_store_plan_forcing_locations AS pfl WHERE pfl.plan_id = p.plan_id AND pfl.replica_group_id = ${queryStoreParameters.replicaGroupId}) THEN 1 ELSE 0 END)`;
}

function isPrimary(target: ResolvedQueryWindow): boolean {
    return target.replicaGroupId === String(replicaGroupIds.primary);
}

function familyMissing(family: QueryStoreFamily): MissingDataCode[] {
    return family === "synapseDedicated" ? ["queryStoreResourceMetrics"] : [];
}

/** Maps the rows (one for each interval and plan) to intervals with their plans. */
function toHistoryIntervals(records: readonly SqlRecord[]): QueryHistoryInterval[] {
    const intervals: QueryHistoryInterval[] = [];
    let plans: QueryHistoryPlanStats[] = [];
    let startUtc = "";
    let endUtc = "";
    const close = () => {
        if (plans.length > 0) {
            intervals.push({ startUtc, endUtc, ...combineStats(plans), plans });
        }
    };
    for (const record of records) {
        const recordStart = readDateTime(record, "start_time") ?? "";
        if (recordStart !== startUtc) {
            close();
            plans = [];
            startUtc = recordStart;
            endUtc = readDateTime(record, "end_time") ?? "";
        }
        plans.push({ planId: readId(record, "plan_id") ?? "", ...toHistoryStats(record) });
    }
    close();
    return intervals;
}

function toHistoryStats(record: SqlRecord): QueryHistoryStats {
    const executionCount = readNumber(record, "execution_count") ?? 0;
    const totalDurationMs = readNumber(record, "total_duration_ms") ?? 0;
    const totalCpuMs = readNumber(record, "total_cpu_ms");
    const totalLogicalReads = readNumber(record, "total_logical_reads");
    return withValues({
        executionCount,
        totalDurationMs,
        avgDurationMs: average(totalDurationMs, executionCount),
        minDurationMs: readNumber(record, "min_duration_ms"),
        maxDurationMs: readNumber(record, "max_duration_ms"),
        totalCpuMs: totalCpuMs ?? 0,
        avgCpuMs: average(totalCpuMs, executionCount),
        minCpuMs: readNumber(record, "min_cpu_ms"),
        maxCpuMs: readNumber(record, "max_cpu_ms"),
        totalLogicalReads: totalLogicalReads ?? 0,
        avgLogicalReads: average(totalLogicalReads, executionCount),
        minLogicalReads: readNumber(record, "min_logical_reads"),
        maxLogicalReads: readNumber(record, "max_logical_reads"),
    });
}

/** The stats of all plans of an interval together. */
function combineStats(plans: readonly QueryHistoryStats[]): QueryHistoryStats {
    const sum = (pick: (stats: QueryHistoryStats) => number) =>
        plans.reduce((total, stats) => total + pick(stats), 0);
    const extreme = (
        pick: (stats: QueryHistoryStats) => number | undefined,
        choose: (...values: number[]) => number,
    ) => {
        const values = plans.map(pick).filter((value): value is number => value !== undefined);
        return values.length > 0 ? choose(...values) : undefined;
    };
    const executionCount = sum((stats) => stats.executionCount);
    const totalDurationMs = sum((stats) => stats.totalDurationMs);
    const totalCpuMs = sum((stats) => stats.totalCpuMs);
    const totalLogicalReads = sum((stats) => stats.totalLogicalReads);
    return withValues({
        executionCount,
        totalDurationMs,
        avgDurationMs: average(totalDurationMs, executionCount),
        minDurationMs: extreme((stats) => stats.minDurationMs, Math.min),
        maxDurationMs: extreme((stats) => stats.maxDurationMs, Math.max),
        totalCpuMs,
        avgCpuMs: average(totalCpuMs, executionCount),
        minCpuMs: extreme((stats) => stats.minCpuMs, Math.min),
        maxCpuMs: extreme((stats) => stats.maxCpuMs, Math.max),
        totalLogicalReads,
        avgLogicalReads: average(totalLogicalReads, executionCount),
        minLogicalReads: extreme((stats) => stats.minLogicalReads, Math.min),
        maxLogicalReads: extreme((stats) => stats.maxLogicalReads, Math.max),
    });
}

function toQueryPlanInfo(record: SqlRecord): QueryPlanInfo {
    const executionCount = readNumber(record, "execution_count") ?? 0;
    return withValues({
        planId: readId(record, "plan_id") ?? "",
        queryPlanHash: normalizeQueryPlanHash(readString(record, "query_plan_hash")),
        isForced: readBoolean(record, "is_forced_plan") ?? false,
        forcingType: readString(record, "plan_forcing_type_desc")?.trim().toLowerCase(),
        planType: readString(record, "plan_type_desc"),
        isParallel: readBoolean(record, "is_parallel_plan"),
        forceFailureCount: readNumber(record, "force_failure_count") ?? 0,
        lastForceFailureReason: readString(record, "last_force_failure_reason_desc"),
        countCompiles: readNumber(record, "count_compiles"),
        initialCompileTime: readDateTime(record, "initial_compile_start_time"),
        lastCompileTime: readDateTime(record, "last_compile_start_time"),
        lastExecutionTime: readDateTime(record, "last_execution_time"),
        executionCount,
        avgDurationMs: average(readNumber(record, "total_duration_ms"), executionCount),
        avgCpuMs: average(readNumber(record, "total_cpu_ms"), executionCount),
    });
}

/** The total divided by the executions, or undefined without executions. */
function average(total: number | undefined, executionCount: number): number | undefined {
    return total !== undefined && executionCount > 0 ? total / executionCount : undefined;
}

/** Leaves out the values that are undefined. */
function withValues<T extends object>(values: { [K in keyof T]: T[K] | undefined }): T {
    return Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
    ) as T;
}
