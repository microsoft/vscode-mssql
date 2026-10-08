/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import {
    SqlReader,
    SqlRecord,
    SqlResultSet,
    parseSqlDateTime,
    readBoolean,
    readDateTime,
    readId,
    readNumber,
    readString,
    toRecords,
} from "../../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "../result";
import { readOptionsOf } from "../runOptions";
import { queryStoreConstants } from "../queryStore/common/configuration";
import {
    QueryStoreOperationalStatus,
    QueryStoreReadOnlyReason,
    getQueryStoreReadOnlyReason,
} from "../queryStore/common/operationalMode";
import {
    getRuntimeStatsSummary,
    queryStoreParameters,
} from "../queryStore/common/queryGeneratorUtils";
import { replicaGroupIds } from "../queryStore/common/replicaGroup";
import { replicaGroupIdParameter } from "../queryStore/common/reportParameters";
import {
    QueryStoreSqlParameter,
    formatBigInt,
    prependSqlParameters,
} from "../queryStore/common/sqlParameters";
import { assertValidDate } from "../queryStore/common/timeInterval";
import { getForcePlanQuery, getUnforcePlanQuery } from "../queryStore/planSummary";
import { normalizeQueryPlanHash } from "./reportData";
import {
    PlanColumnAvailability,
    QueryStoreProbe,
    QueryStoreRunOptions,
    queryStoreFamily,
    readQueryStoreProbe,
    runWithQueryStore,
} from "./runContext";

/*
 * The change path for plan forcing. The library does not ask for approval. A caller must:
 *
 * 1. call prepareForcePlan or prepareUnforcePlan, and show the prepared change (its SQL, prior
 *    state, blockers, and warnings) to the user;
 * 2. get the user's approval, only when the change has no blockers;
 * 3. call applyPreparedChange, which reads the state again and refuses the change if the state
 *    changed;
 * 4. call verifyForcedPlan later, to confirm that new executions use the forced plan.
 */

export type PlanChangeKind = "forcePlan" | "unforcePlan";

export interface PlanChangeRequest {
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: number | bigint | string;
    /** The Query Store `plan_id`. A `bigint`. */
    readonly planId: number | bigint | string;
    /**
     * The replica group to force the plan on. Default 1, the primary. A group other than the
     * primary needs Query Store for secondary replicas.
     */
    readonly replicaGroupId?: number | bigint | string;
}

/** The plan and query of a change, as decimal strings. */
export interface PlanChangeTarget {
    readonly queryId: string;
    readonly planId: string;
    readonly replicaGroupId: string;
}

/** `plan_forcing_type_desc`. `auto` means that automatic tuning forced the plan. */
export type PlanForcingType = "none" | "manual" | "auto" | "unknown";

/**
 * `plan_type_desc`. Parameter sensitive plan optimization (SQL Server 2022 and later) makes a
 * dispatcher plan for the parent query and a variant plan for each variant query.
 */
export type QueryStorePlanType = "compiled" | "dispatcher" | "variant" | "unknown";

/** A `sys.query_store_plan` row. */
export interface PlanForcingInfo {
    readonly planId: string;
    /** The query that owns the plan. */
    readonly queryId: string;
    /** `0x` hex. Plans with the same hash have the same shape. */
    readonly queryPlanHash?: string;
    /** For a replica group other than the primary, forced on that replica group. */
    readonly isForced: boolean;
    /** Undefined when the server does not have the column, or for a secondary replica group. */
    readonly forcingType?: PlanForcingType;
    /** Undefined when the server does not have the column. */
    readonly planType?: QueryStorePlanType;
    /** The number of failed forcing attempts. It increases at a compile, not at each execution. */
    readonly forceFailureCount: number;
    /** `last_force_failure_reason_desc`, for example `NONE`, `NO_INDEX`, or `NO_PLAN`. */
    readonly lastForceFailureReason?: string;
    /** ISO 8601 UTC. */
    readonly lastExecutionTime?: string;
}

/** The state that a plan change depends on. */
export interface PlanForcingState {
    readonly queryStoreStatus: QueryStoreOperationalStatus;
    readonly readOnlyReason?: QueryStoreReadOnlyReason;
    /** The target plan. Undefined when Query Store does not have it. */
    readonly plan?: PlanForcingInfo;
    /** The plans that are forced for the target query now. */
    readonly forcedPlans: readonly PlanForcingInfo[];
    readonly hasPlanForcingType: boolean;
    readonly hasPlanType: boolean;
    /** The server time of the read, ISO 8601 UTC. */
    readonly serverTimeUtc?: string;
}

/** Why a change must not run. */
export type PlanChangeBlocker =
    /** Query Store is not READ_WRITE. `prior.queryStoreStatus` has the state. */
    | "queryStoreNotReadWrite"
    | "planNotFound"
    /** The plan belongs to another query. */
    | "planNotForQuery"
    /** Force: the plan is forced already. */
    | "planAlreadyForced"
    /** Unforce: the plan is not forced. */
    | "planNotForced"
    /** Automatic tuning forced a plan for the query. Change it through automatic tuning. */
    | "autoForcedPlan"
    /** Force: a dispatcher plan. Force the variant plan on the variant query instead. */
    | "dispatcherPlan"
    /** Apply: the state is not the same as when the change was prepared. */
    | "stateChanged"
    /** Apply: the prepared SQL is not the SQL for the target. */
    | "preparedSqlMismatch";

/** What the user should know before approving a change. */
export type PlanChangeWarning =
    /** Force: another plan is forced for the query. Forcing this plan replaces it. */
    | "replacesForcedPlan"
    /**
     * The server does not show whether automatic tuning forced a plan (SQL Server 2016, or a
     * secondary replica group).
     */
    | "planForcingTypeUnknown"
    /** A query variant plan of parameter sensitive plan optimization. */
    | "variantPlan"
    /** Unforce: a dispatcher plan. */
    | "dispatcherPlan"
    /** Force: forcing the plan failed before. See `lastForceFailureReason`. */
    | "previousForceFailures";

/**
 * A change for the user to approve. It is JSON-serializable, so a caller can send it to a webview
 * and back. {@link applyPreparedChange} checks it again before it runs.
 */
export interface PreparedChange {
    readonly kind: PlanChangeKind;
    readonly target: PlanChangeTarget;
    /** The exact batch that {@link applyPreparedChange} runs: the change preamble and the EXEC. */
    readonly sql: string;
    /** The state when the change was prepared. */
    readonly prior: PlanForcingState;
    /** When not empty, the change must not run, and `applyPreparedChange` refuses it. */
    readonly blockers: readonly PlanChangeBlocker[];
    readonly warnings: readonly PlanChangeWarning[];
}

export interface AppliedChange {
    /** True when the change ran. */
    readonly applied: boolean;
    /** Why the change did not run. Empty when it ran. */
    readonly blockers: readonly PlanChangeBlocker[];
    /** The state that was read just before the change. */
    readonly current?: PlanForcingState;
    /**
     * The server time just before the change, ISO 8601 UTC. Pass it as `since` to
     * {@link verifyForcedPlan}.
     */
    readonly appliedAtUtc?: string;
}

/**
 * Reads the state and prepares a change that forces the plan for the query. SQL Server 2016 and
 * later, Azure SQL Managed Instance, Azure SQL Database, and SQL database in Fabric. Get the user's
 * approval before {@link applyPreparedChange}.
 */
export function prepareForcePlan(
    reader: SqlReader,
    info: PlatformInfo,
    request: PlanChangeRequest,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<PreparedChange>> {
    return preparePlanChange(reader, info, "forcePlan", request, options);
}

/**
 * Reads the state and prepares a change that stops forcing the plan for the query. Get the user's
 * approval before {@link applyPreparedChange}.
 */
export function prepareUnforcePlan(
    reader: SqlReader,
    info: PlatformInfo,
    request: PlanChangeRequest,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<PreparedChange>> {
    return preparePlanChange(reader, info, "unforcePlan", request, options);
}

/**
 * Runs a prepared change after the user approved it. It reads the state again and refuses the
 * change (`applied: false`) when the change has blockers now, when the state is not the same as
 * in `prepared.prior`, or when `prepared.sql` is not the SQL for the target.
 */
export async function applyPreparedChange(
    reader: SqlReader,
    info: PlatformInfo,
    prepared: PreparedChange,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<AppliedChange>> {
    const now = options.now ?? new Date();
    if (prepared.kind !== "forcePlan" && prepared.kind !== "unforcePlan") {
        throw new RangeError(`"${String(prepared.kind)}" is not a plan change.`);
    }
    const target = resolveTarget(prepared.target);
    return withPlanChangeState(reader, info, target, options, now, async (state, probe) => {
        const refuse = (blockers: PlanChangeBlocker[]): AppliedChange => ({
            applied: false,
            blockers,
            current: state,
        });
        const sql = buildPlanChangeSql(info, prepared.kind, target, probe.isQdsRoAvailable);
        if (sql !== prepared.sql) {
            return refuse(["preparedSqlMismatch"]);
        }
        const { blockers } = assessPlanChange(prepared.kind, target, state);
        if (blockers.length > 0) {
            return refuse(blockers);
        }
        if (planForcingStateKey(state) !== planForcingStateKey(prepared.prior)) {
            return refuse(["stateChanged"]);
        }
        await reader.read(sql, readOptionsOf(options));
        return { applied: true, blockers: [], current: state, appliedAtUtc: state.serverTimeUtc };
    });
}

export interface VerifyForcedPlanRequest {
    readonly queryId: number | bigint | string;
    readonly planId: number | bigint | string;
    /** Count the executions after this time, for example `appliedAtUtc`. */
    readonly since: Date | string;
    readonly replicaGroupId?: number | bigint | string;
}

/** How the executions of a plan relate to the forced plan. */
export type ForcedPlanMatch =
    | "forcedPlan"
    /** Another `plan_id` with the same `query_plan_hash`: the engine compiled the same shape. */
    | "samePlanShape"
    | "otherPlan";

/** The executions of one plan of the query since the given time. */
export interface ForcedPlanExecution {
    readonly planId: string;
    readonly queryPlanHash?: string;
    readonly match: ForcedPlanMatch;
    readonly executionCount: number;
    readonly firstExecutionTime?: string;
    readonly lastExecutionTime?: string;
    readonly avgDurationMs?: number;
    readonly avgCpuTimeMs?: number;
}

export type ForcedPlanOutcome =
    /** Query Store does not have the plan, or it belongs to another query. */
    | "planNotFound"
    | "notForced"
    /** The plan is forced, and the query did not run after `countedFrom`. */
    | "noExecutions"
    /** Every execution after `countedFrom` used the forced plan or the same shape. */
    | "forcedPlanInUse"
    /** Some executions used another plan shape. `plan.lastForceFailureReason` can say why. */
    | "otherPlansInUse"
    /**
     * The plan is forced, and the first Query Store interval after the change did not start yet.
     * Verify again after `countedFrom`.
     */
    | "waitingForNextInterval";

export interface ForcedPlanVerification {
    readonly queryId: string;
    readonly planId: string;
    /** ISO 8601 UTC. */
    readonly since: string;
    /**
     * The start of the counted executions, ISO 8601 UTC: the end of the runtime stats interval
     * that contains `since`. That interval is not counted, because it can include executions from
     * before the change. Equal to `since` when Query Store has no interval that contains it.
     */
    readonly countedFrom: string;
    readonly outcome: ForcedPlanOutcome;
    readonly plan?: PlanForcingInfo;
    /** The executions of each plan of the query in the intervals that start at `countedFrom` or later. */
    readonly executions: readonly ForcedPlanExecution[];
}

/**
 * Reads whether the plan is forced, its forcing failures, and the executions of the query after
 * a time, for each plan, so that the caller can confirm that later executions use the forced plan
 * or a plan with the same shape. It counts only the runtime stats intervals that start after the
 * interval that contains the time, so the first counts come one interval after the change.
 */
export async function verifyForcedPlan(
    reader: SqlReader,
    info: PlatformInfo,
    request: VerifyForcedPlanRequest,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<ForcedPlanVerification>> {
    const target = resolveTarget(request);
    const since =
        typeof request.since === "string" ? parseSqlDateTime(request.since) : request.since;
    if (!since) {
        throw new RangeError(`"${String(request.since)}" is not a date.`);
    }
    assertValidDate(since);

    return runWithQueryStore(
        reader,
        info,
        options,
        {
            planColumns: true,
            replicaGroupId: target.replicaGroupId,
            synapseDedicated: false,
        },
        async (context) => {
            const sql = buildVerifyForcedPlanQuery(
                info,
                target,
                since,
                context.probe.planColumns,
                context.probe.isQdsRoAvailable,
            );
            const [windowSet, planSet, executionSet] = await reader.read(sql, context.readOptions);
            const window = toRecords(windowSet)[0];
            const countedFrom = parseSqlDateTime(window?.counted_from) ?? since;
            const serverTime = parseSqlDateTime(window?.server_time);
            const found = toRecords(planSet).map((record) =>
                toPlanForcingInfo(record, isPrimary(target)),
            )[0];
            const plan = found && found.queryId === target.queryId ? found : undefined;
            const executions = toRecords(executionSet)
                .map((record) => toExecution(record, target, plan))
                .sort((left, right) => right.executionCount - left.executionCount);
            const data: ForcedPlanVerification = {
                queryId: target.queryId,
                planId: target.planId,
                since: since.toISOString(),
                countedFrom: countedFrom.toISOString(),
                outcome: verificationOutcome(
                    plan,
                    executions,
                    !!serverTime && serverTime.getTime() < countedFrom.getTime(),
                ),
                ...(plan ? { plan } : {}),
                executions,
            };
            return plan ? { status: "ready", data } : { status: "noData", data };
        },
    );
}

/**
 * Returns the blockers and warnings of a change in a state. Exported so that callers can show
 * them again for a new state.
 */
export function assessPlanChange(
    kind: PlanChangeKind,
    target: PlanChangeTarget,
    state: PlanForcingState,
): { readonly blockers: PlanChangeBlocker[]; readonly warnings: PlanChangeWarning[] } {
    const blockers: PlanChangeBlocker[] = [];
    const warnings: PlanChangeWarning[] = [];
    if (state.queryStoreStatus !== "readWrite") {
        blockers.push("queryStoreNotReadWrite");
    }
    const plan = state.plan;
    if (!plan) {
        blockers.push("planNotFound");
    } else if (plan.queryId !== target.queryId) {
        blockers.push("planNotForQuery");
    }
    if (state.forcedPlans.some((forced) => forced.forcingType === "auto")) {
        blockers.push("autoForcedPlan");
    }
    if (!state.hasPlanForcingType || !isPrimary(target)) {
        warnings.push("planForcingTypeUnknown");
    }
    if (plan && plan.queryId === target.queryId) {
        if (plan.planType === "variant") {
            warnings.push("variantPlan");
        }
        if (kind === "forcePlan") {
            if (plan.isForced) {
                blockers.push("planAlreadyForced");
            }
            if (plan.planType === "dispatcher") {
                blockers.push("dispatcherPlan");
            }
            if (state.forcedPlans.some((forced) => forced.planId !== plan.planId)) {
                warnings.push("replacesForcedPlan");
            }
            if (plan.forceFailureCount > 0 || hasFailureReason(plan)) {
                warnings.push("previousForceFailures");
            }
        } else {
            if (!plan.isForced) {
                blockers.push("planNotForced");
            }
            if (plan.planType === "dispatcher") {
                warnings.push("dispatcherPlan");
            }
        }
    }
    return { blockers, warnings };
}

/**
 * Returns the batch of a change: the change preamble, and the port's `sp_query_store_force_plan`
 * or `sp_query_store_unforce_plan` call. It passes `@replica_group_id` only when the server has
 * Query Store for secondary replicas, like SQL Tools Service.
 */
export function buildPlanChangeSql(
    info: PlatformInfo,
    kind: PlanChangeKind,
    target: PlanChangeTarget,
    isQdsRoAvailable: boolean,
): string {
    const replicaGroupId = isQdsRoAvailable
        ? target.replicaGroupId
        : queryStoreConstants.replicaGroupIdUnavailable;
    const call =
        kind === "forcePlan"
            ? getForcePlanQuery(target.queryId, target.planId, replicaGroupId)
            : getUnforcePlanQuery(target.queryId, target.planId, replicaGroupId);
    return `${sessionPreamble(info, "change")}\n${call}`;
}

/**
 * Returns the batch that reads the state of a change: the server time, the target plan, and the
 * plans that are forced for the query. Exported for tests.
 */
export function buildPlanForcingStateQuery(
    info: PlatformInfo,
    target: PlanChangeTarget,
    planColumns: PlanColumnAvailability,
): string {
    const forced = forcedExpression(target);
    const body = `SELECT SYSDATETIMEOFFSET() AS server_time;
SELECT
${planSelectList(planColumns, target, forced)}
FROM sys.query_store_plan AS p
WHERE p.plan_id = ${queryStoreParameters.planId};
SELECT
${planSelectList(planColumns, target, forced)}
FROM sys.query_store_plan AS p
WHERE p.query_id = ${queryStoreParameters.queryId}
    AND ${forced} = 1;`;
    return `${sessionPreamble(info, "read")}\n${prependSqlParameters(body, targetParameters(target))}`;
}

/** Returns the batch of {@link verifyForcedPlan}. Exported for tests. */
export function buildVerifyForcedPlanQuery(
    info: PlatformInfo,
    target: PlanChangeTarget,
    since: Date,
    planColumns: PlanColumnAvailability,
    isQdsRoAvailable: boolean,
): string {
    const sinceParameter = "@since";
    const parameters: QueryStoreSqlParameter[] = [
        ...targetParameters(target),
        { name: sinceParameter, type: "datetimeoffset", value: since },
    ];
    // The target parameters have the replica group of a secondary already.
    if (isQdsRoAvailable && isPrimary(target)) {
        parameters.push(replicaGroupIdParameter(target.replicaGroupId));
    }
    const replicaFilter = isQdsRoAvailable
        ? `\n    AND rs.replica_group_id = ${queryStoreParameters.replicaGroupId}`
        : "";
    // The interval that contains @since can include executions from before the change, so the
    // count starts at its end.
    const body = `DECLARE @counted_from DATETIMEOFFSET = ISNULL(
    (SELECT TOP (1) rsi.end_time
    FROM sys.query_store_runtime_stats_interval AS rsi
    WHERE rsi.start_time <= ${sinceParameter}
        AND rsi.end_time > ${sinceParameter}
    ORDER BY rsi.start_time DESC),
    ${sinceParameter});
SELECT @counted_from AS counted_from, SYSDATETIMEOFFSET() AS server_time;
SELECT
${planSelectList(planColumns, target, forcedExpression(target))}
FROM sys.query_store_plan AS p
WHERE p.plan_id = ${queryStoreParameters.planId};
SELECT
    CONVERT(varchar(20), p.plan_id) AS plan_id,
    CONVERT(varchar(18), p.query_plan_hash, 1) AS query_plan_hash,
    SUM(rs.count_executions) AS count_executions,
    MIN(rs.first_execution_time) AS first_execution_time,
    MAX(rs.last_execution_time) AS last_execution_time,
    ${getRuntimeStatsSummary("avg", "duration", "rs")} AS avg_duration_ms,
    ${getRuntimeStatsSummary("avg", "cpuTime", "rs")} AS avg_cpu_time_ms
FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
WHERE p.query_id = ${queryStoreParameters.queryId}
    AND rsi.start_time >= @counted_from${replicaFilter}
GROUP BY p.plan_id, p.query_plan_hash;`;
    return `${sessionPreamble(info, "read")}\n${prependSqlParameters(body, parameters)}`;
}

/**
 * The values of a state that a change depends on. The execution times and failure counts change
 * while the query runs, so they are not part of it.
 */
export function planForcingStateKey(state: PlanForcingState): string {
    const plan = (info: PlanForcingInfo | undefined) =>
        info
            ? [
                  info.planId,
                  info.queryId,
                  info.queryPlanHash ?? "",
                  info.isForced,
                  info.forcingType ?? "",
                  info.planType ?? "",
              ]
            : [];
    return JSON.stringify([
        state?.queryStoreStatus ?? "",
        plan(state?.plan),
        (state?.forcedPlans ?? [])
            .map((forced) => [forced.planId, forced.forcingType ?? ""].join(":"))
            .sort(),
    ]);
}

async function preparePlanChange(
    reader: SqlReader,
    info: PlatformInfo,
    kind: PlanChangeKind,
    request: PlanChangeRequest,
    options: QueryStoreRunOptions,
): Promise<PerfResult<PreparedChange>> {
    const now = options.now ?? new Date();
    const target = resolveTarget(request);
    return withPlanChangeState(reader, info, target, options, now, async (state, probe) => {
        const { blockers, warnings } = assessPlanChange(kind, target, state);
        return {
            kind,
            target,
            sql: buildPlanChangeSql(info, kind, target, probe.isQdsRoAvailable),
            prior: state,
            blockers,
            warnings,
        };
    });
}

/**
 * Checks the platform, reads the probe and the state, and runs `body`. A replica group other than
 * the primary without Query Store for secondary replicas gives `unsupported`. Query Store OFF is
 * a blocker, not a status, so that the caller can show it.
 */
async function withPlanChangeState<T>(
    reader: SqlReader,
    info: PlatformInfo,
    target: PlanChangeTarget,
    options: QueryStoreRunOptions,
    now: Date,
    body: (state: PlanForcingState, probe: QueryStoreProbe) => Promise<T>,
): Promise<PerfResult<T>> {
    const family = queryStoreFamily(info);
    if (family !== "sqlEngine") {
        return unsupportedResult(info, now);
    }
    const base = {
        platform: info.platform,
        source: "queryStore",
        scope: "database",
        observedAtUtc: now.toISOString(),
    } as const;
    try {
        const probe = await readQueryStoreProbe(
            reader,
            info,
            family,
            { planColumns: true },
            options,
        );
        if (!isPrimary(target) && !probe.isQdsRoAvailable) {
            return { ...base, status: "unsupported", missing: [] };
        }
        const resultSets = await reader.read(
            buildPlanForcingStateQuery(info, target, probe.planColumns),
            readOptionsOf(options),
        );
        const state = toPlanForcingState(probe, target, resultSets);
        return { ...base, status: "ready", data: await body(state, probe), missing: [] };
    } catch (error) {
        return errorResult(info, error, now, "queryStore");
    }
}

function toPlanForcingState(
    probe: QueryStoreProbe,
    target: PlanChangeTarget,
    resultSets: readonly SqlResultSet[],
): PlanForcingState {
    const [timeSet, planSet, forcedSet] = resultSets;
    const primary = isPrimary(target);
    const status = probe.mode.operationalStatus;
    return {
        queryStoreStatus: status,
        readOnlyReason:
            status === "readOnly"
                ? getQueryStoreReadOnlyReason(probe.mode.readOnlyReason)
                : undefined,
        plan: toRecords(planSet).map((record) => toPlanForcingInfo(record, primary))[0],
        forcedPlans: toRecords(forcedSet).map((record) => toPlanForcingInfo(record, primary)),
        hasPlanForcingType: probe.planColumns.hasPlanForcingType,
        hasPlanType: probe.planColumns.hasPlanType,
        serverTimeUtc: readDateTime(toRecords(timeSet)[0] ?? {}, "server_time"),
    };
}

function toPlanForcingInfo(record: SqlRecord, primary: boolean): PlanForcingInfo {
    return {
        planId: readId(record, "plan_id") ?? "",
        queryId: readId(record, "query_id") ?? "",
        queryPlanHash: normalizeQueryPlanHash(readString(record, "query_plan_hash")),
        isForced: readBoolean(record, "is_forced_plan") ?? false,
        forcingType: primary
            ? mapForcingType(readString(record, "plan_forcing_type_desc"))
            : undefined,
        planType: mapPlanType(readString(record, "plan_type_desc")),
        forceFailureCount: readNumber(record, "force_failure_count") ?? 0,
        lastForceFailureReason: readString(record, "last_force_failure_reason_desc"),
        lastExecutionTime: readDateTime(record, "last_execution_time"),
    };
}

function toExecution(
    record: SqlRecord,
    target: PlanChangeTarget,
    plan: PlanForcingInfo | undefined,
): ForcedPlanExecution {
    const planId = readId(record, "plan_id") ?? "";
    const queryPlanHash = normalizeQueryPlanHash(readString(record, "query_plan_hash"));
    const match: ForcedPlanMatch =
        planId === target.planId
            ? "forcedPlan"
            : queryPlanHash !== undefined && queryPlanHash === plan?.queryPlanHash
              ? "samePlanShape"
              : "otherPlan";
    return {
        planId,
        queryPlanHash,
        match,
        executionCount: readNumber(record, "count_executions") ?? 0,
        firstExecutionTime: readDateTime(record, "first_execution_time"),
        lastExecutionTime: readDateTime(record, "last_execution_time"),
        avgDurationMs: readNumber(record, "avg_duration_ms"),
        avgCpuTimeMs: readNumber(record, "avg_cpu_time_ms"),
    };
}

function verificationOutcome(
    plan: PlanForcingInfo | undefined,
    executions: readonly ForcedPlanExecution[],
    waitingForNextInterval: boolean,
): ForcedPlanOutcome {
    if (!plan) {
        return "planNotFound";
    }
    if (!plan.isForced) {
        return "notForced";
    }
    if (waitingForNextInterval) {
        return "waitingForNextInterval";
    }
    const ran = executions.filter((execution) => execution.executionCount > 0);
    if (ran.length === 0) {
        return "noExecutions";
    }
    return ran.every((execution) => execution.match !== "otherPlan")
        ? "forcedPlanInUse"
        : "otherPlansInUse";
}

function planSelectList(
    planColumns: PlanColumnAvailability,
    target: PlanChangeTarget,
    forced: string,
): string {
    const forcingType =
        planColumns.hasPlanForcingType && isPrimary(target)
            ? "p.plan_forcing_type_desc"
            : "CAST(NULL AS nvarchar(60)) AS plan_forcing_type_desc";
    const planType = planColumns.hasPlanType
        ? "p.plan_type_desc"
        : "CAST(NULL AS nvarchar(120)) AS plan_type_desc";
    return [
        "    CONVERT(varchar(20), p.plan_id) AS plan_id,",
        "    CONVERT(varchar(20), p.query_id) AS query_id,",
        "    CONVERT(varchar(18), p.query_plan_hash, 1) AS query_plan_hash,",
        `    ${forced} AS is_forced_plan,`,
        "    p.force_failure_count,",
        "    p.last_force_failure_reason_desc,",
        `    ${forcingType},`,
        `    ${planType},`,
        "    p.last_execution_time",
    ].join("\n");
}

/** `is_forced_plan`, or the forcing location of a secondary replica group. */
function forcedExpression(target: PlanChangeTarget): string {
    return isPrimary(target)
        ? "p.is_forced_plan"
        : `CONVERT(bit, CASE WHEN EXISTS (SELECT 1 FROM sys.query_store_plan_forcing_locations AS pfl WHERE pfl.plan_id = p.plan_id AND pfl.replica_group_id = ${queryStoreParameters.replicaGroupId}) THEN 1 ELSE 0 END)`;
}

function targetParameters(target: PlanChangeTarget): QueryStoreSqlParameter[] {
    const parameters: QueryStoreSqlParameter[] = [
        { name: queryStoreParameters.queryId, type: "bigint", value: target.queryId },
        { name: queryStoreParameters.planId, type: "bigint", value: target.planId },
    ];
    if (!isPrimary(target)) {
        parameters.push(replicaGroupIdParameter(target.replicaGroupId));
    }
    return parameters;
}

function resolveTarget(request: PlanChangeRequest | PlanChangeTarget): PlanChangeTarget {
    if (!request || typeof request !== "object") {
        throw new RangeError("The plan change needs a query ID and a plan ID.");
    }
    return {
        queryId: formatBigInt(request.queryId),
        planId: formatBigInt(request.planId),
        replicaGroupId: formatBigInt(request.replicaGroupId ?? replicaGroupIds.primary),
    };
}

function isPrimary(target: PlanChangeTarget): boolean {
    return target.replicaGroupId === String(replicaGroupIds.primary);
}

function hasFailureReason(plan: PlanForcingInfo): boolean {
    const reason = plan.lastForceFailureReason?.trim().toUpperCase();
    return reason !== undefined && reason !== "" && reason !== "NONE";
}

function mapForcingType(value: string | undefined): PlanForcingType | undefined {
    if (value === undefined) {
        return undefined;
    }
    switch (value.trim().toUpperCase()) {
        case "NONE":
            return "none";
        case "MANUAL":
            return "manual";
        case "AUTO":
            return "auto";
        default:
            return "unknown";
    }
}

function mapPlanType(value: string | undefined): QueryStorePlanType | undefined {
    if (value === undefined) {
        return undefined;
    }
    const text = value.toUpperCase();
    if (text.includes("DISPATCHER")) {
        return "dispatcher";
    }
    if (text.includes("VARIANT")) {
        return "variant";
    }
    return text.includes("COMPILED") ? "compiled" : "unknown";
}
