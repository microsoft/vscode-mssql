/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlBigIntLiteral } from "../common/literals";
import {
    SqlReader,
    SqlRecord,
    readBoolean,
    readDateTime,
    readId,
    readNumber,
    readString,
    toRecords,
} from "../common/sqlReader";
import { QueryStoreCapabilities } from "./capabilities";
import { QueryStoreMetric, QueryStoreRuntimeStats } from "./metrics";
import {
    readRuntimeStats,
    resolveMetrics,
    runtimeStatsColumns,
    windowedRuntimeStats,
} from "./runtimeStats";
import {
    QueryStoreReadOptions,
    QueryStoreResult,
    TimeWindow,
    runQueryStoreRead,
    windowDeclarations,
} from "./state";

/** `plan_forcing_type_desc`. `auto` means that automatic tuning forced the plan. */
export type QueryStorePlanForcingType = "none" | "manual" | "auto";

/**
 * `plan_type_desc`. Parameter sensitive plan optimization makes a dispatcher plan for the parent
 * query and a variant plan for each variant query.
 */
export type QueryStorePlanType = "compiled" | "dispatcher" | "variant";

/** The facts of a `sys.query_store_plan` row. */
export interface QueryStorePlanInfo {
    /** A `bigint` as decimal text. */
    readonly planId: string;
    readonly queryId: string;
    /** `0x` hex. Plans with the same hash have the same shape. */
    readonly planHash?: string;
    readonly isForced: boolean;
    /** Absent when the server does not record it. */
    readonly forcingType?: QueryStorePlanForcingType;
    /** Absent when the server does not record it. */
    readonly planType?: QueryStorePlanType;
    /** The failed forcing attempts. It increases at a compile, not at each execution. */
    readonly forceFailureCount: number;
    /** `last_force_failure_reason_desc`, for example `NO_INDEX`. Absent for `NONE`. */
    readonly lastForceFailureReason?: string;
    /** ISO 8601 UTC. */
    readonly lastExecutionTimeUtc?: string;
}

/** A plan of a query, with its runtime stats in a window. */
export interface QueryStorePlan extends QueryStorePlanInfo, QueryStoreRuntimeStats {
    readonly isParallel: boolean;
    readonly compileCount: number;
    /** ISO 8601 UTC. */
    readonly initialCompileTimeUtc?: string;
    readonly lastCompileTimeUtc?: string;
}

export interface QueryPlansRequest extends TimeWindow {
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: string;
    readonly metrics: readonly QueryStoreMetric[];
}

/**
 * Reads every plan of the query, by plan ID, with its runtime stats in the window. A plan that did
 * not run in the window has no executions. `noData` when Query Store has no plan of the query.
 */
export async function getQueryPlans(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    request: QueryPlansRequest,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<readonly QueryStorePlan[]>> {
    const metrics = resolveMetrics(capabilities, request.metrics);
    const body = `SELECT
    ${planInfoColumns(capabilities)},
    p.is_parallel_plan,
    p.count_compiles,
    p.initial_compile_start_time,
    p.last_compile_start_time,
    w.*
FROM sys.query_store_plan AS p
    LEFT JOIN (
        SELECT
            rs.plan_id AS stats_plan_id,
            ${runtimeStatsColumns(metrics)}
        ${windowedRuntimeStats(capabilities, "rs.plan_id IN (SELECT qp.plan_id FROM sys.query_store_plan AS qp WHERE qp.query_id = @query_id)")}
        GROUP BY rs.plan_id
    ) AS w ON w.stats_plan_id = p.plan_id
WHERE p.query_id = @query_id
ORDER BY p.plan_id;`;
    return runQueryStoreRead(reader, capabilities, options, {
        declarations: [
            ...windowDeclarations(request),
            `DECLARE @query_id bigint = ${sqlBigIntLiteral(request.queryId)};`,
        ],
        body,
        map: ([resultSet]) => {
            const plans = toRecords(resultSet).map((record): QueryStorePlan => {
                const initialCompileTimeUtc = readDateTime(record, "initial_compile_start_time");
                const lastCompileTimeUtc = readDateTime(record, "last_compile_start_time");
                return {
                    ...toPlanInfo(record),
                    isParallel: readBoolean(record, "is_parallel_plan") ?? false,
                    compileCount: readNumber(record, "count_compiles") ?? 0,
                    ...(initialCompileTimeUtc ? { initialCompileTimeUtc } : {}),
                    ...(lastCompileTimeUtc ? { lastCompileTimeUtc } : {}),
                    ...readRuntimeStats(record, metrics),
                };
            });
            return plans.length > 0 ? plans : undefined;
        },
    });
}

/** Reads the showplan XML of a plan. `noData` when Query Store does not have the plan. */
export async function getPlanXml(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    planId: string,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<string>> {
    return runQueryStoreRead(reader, capabilities, options, {
        declarations: [`DECLARE @plan_id bigint = ${sqlBigIntLiteral(planId)};`],
        body: "SELECT p.query_plan FROM sys.query_store_plan AS p WHERE p.plan_id = @plan_id;",
        // Query Store keeps its plans when it is off, so they can still be opened.
        allStates: true,
        map: ([resultSet]) => readString(toRecords(resultSet)[0] ?? {}, "query_plan") || undefined,
    });
}

/** @internal The select list of {@link QueryStorePlanInfo} over `sys.query_store_plan AS p`. */
export function planInfoColumns(capabilities: QueryStoreCapabilities): string {
    return [
        "p.plan_id",
        "p.query_id",
        "CONVERT(varchar(18), p.query_plan_hash, 1) AS query_plan_hash",
        "p.is_forced_plan",
        "p.force_failure_count",
        "p.last_force_failure_reason_desc",
        "p.last_execution_time",
        capabilities.hasPlanForcingType
            ? "p.plan_forcing_type_desc"
            : "CAST(NULL AS nvarchar(60)) AS plan_forcing_type_desc",
        capabilities.hasPlanType
            ? "p.plan_type_desc"
            : "CAST(NULL AS nvarchar(120)) AS plan_type_desc",
    ].join(",\n    ");
}

/** @internal Maps the columns of {@link planInfoColumns}. */
export function toPlanInfo(record: SqlRecord): QueryStorePlanInfo {
    const planHash = readString(record, "query_plan_hash")?.trim().toUpperCase();
    const forcingType = toForcingType(readString(record, "plan_forcing_type_desc"));
    const planType = toPlanType(readString(record, "plan_type_desc"));
    const failureReason = readString(record, "last_force_failure_reason_desc")?.trim();
    const lastExecutionTimeUtc = readDateTime(record, "last_execution_time");
    return {
        planId: readId(record, "plan_id") ?? "",
        queryId: readId(record, "query_id") ?? "",
        ...(planHash
            ? { planHash: planHash.startsWith("0X") ? `0x${planHash.slice(2)}` : planHash }
            : {}),
        isForced: readBoolean(record, "is_forced_plan") ?? false,
        ...(forcingType ? { forcingType } : {}),
        ...(planType ? { planType } : {}),
        forceFailureCount: readNumber(record, "force_failure_count") ?? 0,
        ...(failureReason && failureReason.toUpperCase() !== "NONE"
            ? { lastForceFailureReason: failureReason }
            : {}),
        ...(lastExecutionTimeUtc ? { lastExecutionTimeUtc } : {}),
    };
}

function toForcingType(value: string | undefined): QueryStorePlanForcingType | undefined {
    switch (value?.trim().toUpperCase()) {
        case "NONE":
            return "none";
        case "MANUAL":
            return "manual";
        case "AUTO":
            return "auto";
        default:
            return undefined;
    }
}

function toPlanType(value: string | undefined): QueryStorePlanType | undefined {
    const text = value?.toUpperCase() ?? "";
    if (text.includes("DISPATCHER")) {
        return "dispatcher";
    }
    if (text.includes("VARIANT")) {
        return "variant";
    }
    return text.includes("COMPILED") ? "compiled" : undefined;
}
