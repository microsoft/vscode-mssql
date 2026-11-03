/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlBigIntLiteral, sqlDateTimeOffsetLiteral } from "../common/literals";
import { errorResult } from "../common/result";
import { sessionPreamble } from "../common/session";
import {
    SqlReader,
    parseSqlDateTime,
    readDateTime,
    readId,
    readString,
    toIdText,
    toRecords,
} from "../common/sqlReader";
import { QueryStoreCapabilities } from "./capabilities";
import { QueryStoreRuntimeStats } from "./metrics";
import { QueryStorePlanInfo, planInfoColumns, toPlanInfo } from "./plans";
import { readRuntimeStats, runtimeStatsColumns } from "./runtimeStats";
import {
    QueryStoreReadOptions,
    QueryStoreResult,
    QueryStoreStatus,
    runQueryStoreRead,
} from "./state";

/*
 * Forcing and unforcing a plan. The library does not ask for approval. A caller must:
 *
 * 1. call preparePlanChange, and show the prepared change (its SQL, the state, blockers, and
 *    warnings) to the user;
 * 2. get the user's approval, only when the change has no blockers;
 * 3. call applyPlanChange, which reads the state again and refuses the change if it changed;
 * 4. call verifyForcedPlan later, to see whether new executions use the forced plan.
 *
 * Changes apply to the primary replica.
 */

export type PlanChangeKind = "forcePlan" | "unforcePlan";

export interface PlanChangeTarget {
    readonly kind: PlanChangeKind;
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: string;
    /** The Query Store `plan_id`. A `bigint`. */
    readonly planId: string;
}

/** The state that a plan change depends on. */
export interface PlanForcingState {
    readonly queryStore: QueryStoreStatus;
    /** The target plan. Absent when Query Store does not have it. */
    readonly plan?: QueryStorePlanInfo;
    /** The plans that are forced for the target query now. */
    readonly forcedPlans: readonly QueryStorePlanInfo[];
    /** The server time of the read, ISO 8601 UTC. */
    readonly serverTimeUtc?: string;
}

/** Why a change must not run. */
export type PlanChangeBlocker =
    /** Query Store is not read-write. */
    | "queryStoreNotReadWrite"
    | "planNotFound"
    /** The plan belongs to another query. */
    | "planNotForQuery"
    | "planAlreadyForced"
    | "planNotForced"
    /** Automatic tuning forced a plan for the query. Change it through automatic tuning. */
    | "autoForcedPlan"
    /** A dispatcher plan cannot be forced. Force the variant plan of the variant query. */
    | "dispatcherPlan"
    /** Apply: the state is not the same as when the change was prepared. */
    | "stateChanged"
    /** Apply: the prepared SQL is not the SQL for the target. */
    | "preparedSqlMismatch";

/** What the user should know before approving a change. */
export type PlanChangeWarning =
    /** Forcing this plan replaces the plan that is forced now. */
    | "replacesForcedPlan"
    /** The server does not show whether automatic tuning forced a plan. */
    | "planForcingTypeUnknown"
    /** A query variant plan of parameter sensitive plan optimization. */
    | "variantPlan"
    /** Unforce: a dispatcher plan. */
    | "dispatcherPlan"
    /** Forcing the plan failed before. See `lastForceFailureReason`. */
    | "previousForceFailures";

/**
 * A change for the user to approve. It is JSON-serializable, so it can go to a webview and back.
 * {@link applyPlanChange} checks it again before it runs.
 */
export interface PreparedPlanChange {
    readonly target: PlanChangeTarget;
    /** The exact batch that {@link applyPlanChange} runs. */
    readonly sql: string;
    readonly prior: PlanForcingState;
    /** When not empty, the change must not run, and `applyPlanChange` refuses it. */
    readonly blockers: readonly PlanChangeBlocker[];
    readonly warnings: readonly PlanChangeWarning[];
}

export interface AppliedPlanChange {
    readonly applied: boolean;
    /** Why the change did not run. Empty when it ran. */
    readonly blockers: readonly PlanChangeBlocker[];
    /** The server time just before the change. Pass it to {@link verifyForcedPlan}. */
    readonly appliedAtUtc?: string;
}

/** Reads the state of a plan change and prepares it for the user's approval. Changes nothing. */
export async function preparePlanChange(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    target: PlanChangeTarget,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<PreparedPlanChange>> {
    const checked = checkTarget(target);
    const state = await readPlanForcingState(reader, capabilities, checked, options);
    if (!state.data) {
        return { ...state, data: undefined };
    }
    return {
        ...state,
        data: {
            target: checked,
            sql: buildPlanChangeSql(capabilities, checked),
            prior: state.data,
            ...assessPlanChange(capabilities, checked, state.data),
        },
    };
}

/**
 * Runs a prepared change after the user approved it, on a session for changes. It reads the state
 * again and refuses the change when it has blockers now, when the state is not the same as in
 * `prepared.prior`, or when `prepared.sql` is not the SQL for the target.
 */
export async function applyPlanChange(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    prepared: PreparedPlanChange,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<AppliedPlanChange>> {
    const target = checkTarget(prepared.target);
    const state = await readPlanForcingState(reader, capabilities, target, options);
    if (!state.data) {
        return { ...state, data: undefined };
    }
    const refuse = (blockers: PlanChangeBlocker[]): QueryStoreResult<AppliedPlanChange> => ({
        ...state,
        data: { applied: false, blockers },
    });
    const sql = buildPlanChangeSql(capabilities, target);
    if (sql !== prepared.sql) {
        return refuse(["preparedSqlMismatch"]);
    }
    const { blockers } = assessPlanChange(capabilities, target, state.data);
    if (blockers.length > 0) {
        return refuse(blockers);
    }
    if (stateKey(state.data) !== stateKey(prepared.prior)) {
        return refuse(["stateChanged"]);
    }
    try {
        await reader.read(sql, options);
    } catch (error) {
        return { ...errorResult<AppliedPlanChange>(error), queryStore: state.queryStore };
    }
    return {
        ...state,
        data: {
            applied: true,
            blockers: [],
            ...(state.data.serverTimeUtc ? { appliedAtUtc: state.data.serverTimeUtc } : {}),
        },
    };
}

/** Returns the blockers and warnings of a change in a state. */
export function assessPlanChange(
    capabilities: QueryStoreCapabilities,
    target: PlanChangeTarget,
    state: PlanForcingState,
): { readonly blockers: PlanChangeBlocker[]; readonly warnings: PlanChangeWarning[] } {
    const blockers: PlanChangeBlocker[] = [];
    const warnings: PlanChangeWarning[] = [];
    if (state.queryStore.actualState !== "readWrite") {
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
    if (!capabilities.hasPlanForcingType) {
        warnings.push("planForcingTypeUnknown");
    }
    if (plan && plan.queryId === target.queryId) {
        if (plan.planType === "variant") {
            warnings.push("variantPlan");
        }
        if (target.kind === "forcePlan") {
            if (plan.isForced) {
                blockers.push("planAlreadyForced");
            }
            if (plan.planType === "dispatcher") {
                blockers.push("dispatcherPlan");
            }
            if (state.forcedPlans.some((forced) => forced.planId !== plan.planId)) {
                warnings.push("replacesForcedPlan");
            }
            if (plan.forceFailureCount > 0 || plan.lastForceFailureReason) {
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

/** Returns the batch of a change: the change preamble and the force or unforce call. */
export function buildPlanChangeSql(
    capabilities: QueryStoreCapabilities,
    target: PlanChangeTarget,
): string {
    const procedure =
        target.kind === "forcePlan" ? "sp_query_store_force_plan" : "sp_query_store_unforce_plan";
    return [
        sessionPreamble(capabilities.platform, "change"),
        `DECLARE @query_id bigint = ${sqlBigIntLiteral(target.queryId)};`,
        `DECLARE @plan_id bigint = ${sqlBigIntLiteral(target.planId)};`,
        `EXEC sys.${procedure} @query_id = @query_id, @plan_id = @plan_id;`,
    ].join("\n");
}

/** How the executions of a plan relate to the forced plan. */
export type ForcedPlanMatch =
    | "forcedPlan"
    /** Another plan with the same hash: the engine compiled the same shape. */
    | "samePlanShape"
    | "otherPlan";

/** The executions of one plan of the query since the change. */
export interface ForcedPlanExecution extends QueryStoreRuntimeStats {
    readonly planId: string;
    readonly planHash?: string;
    readonly match: ForcedPlanMatch;
}

export type ForcedPlanOutcome =
    /** Query Store does not have the plan, or it belongs to another query. */
    | "planNotFound"
    | "notForced"
    /** The plan is forced, and the query did not run after `countedFromUtc`. */
    | "noExecutions"
    /** Every execution after `countedFromUtc` used the forced plan or the same shape. */
    | "forcedPlanInUse"
    /** Some executions used another plan shape. `plan.lastForceFailureReason` can say why. */
    | "otherPlansInUse"
    /** The first Query Store interval after the change did not start yet. Verify again later. */
    | "waitingForNextInterval";

export interface ForcedPlanVerification {
    /**
     * The start of the counted executions, ISO 8601 UTC: the end of the runtime stats interval that
     * contains the change, which can include executions from before it.
     */
    readonly countedFromUtc: string;
    readonly outcome: ForcedPlanOutcome;
    readonly plan?: QueryStorePlanInfo;
    /** The plans that ran after `countedFromUtc`, most executions first. */
    readonly executions: readonly ForcedPlanExecution[];
}

export interface VerifyForcedPlanRequest {
    readonly queryId: string;
    readonly planId: string;
    /** The time of the change, ISO 8601 UTC, from `appliedAtUtc`. */
    readonly sinceUtc: string;
}

/** Reads whether the plan is still forced, and which plans the query ran since the change. */
export async function verifyForcedPlan(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    request: VerifyForcedPlanRequest,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<ForcedPlanVerification>> {
    const since = parseSqlDateTime(request.sinceUtc);
    if (!since) {
        throw new RangeError(`"${String(request.sinceUtc)}" is not a date.`);
    }
    const metrics = capabilities.metrics.filter(
        (metric) => metric === "duration" || metric === "cpuTime",
    );
    const replicaFilter = capabilities.hasReplicaGroups ? "\n    AND rs.replica_group_id = 1" : "";
    const body = `DECLARE @counted_from datetimeoffset = ISNULL(
    (SELECT TOP (1) rsi.end_time
    FROM sys.query_store_runtime_stats_interval AS rsi
    WHERE rsi.start_time <= @since AND rsi.end_time > @since
    ORDER BY rsi.start_time DESC),
    @since);
SELECT @counted_from AS counted_from, SYSDATETIMEOFFSET() AS server_time;
SELECT
    ${planInfoColumns(capabilities)}
FROM sys.query_store_plan AS p
WHERE p.plan_id = @plan_id;
SELECT
    rs.plan_id,
    CONVERT(varchar(18), p.query_plan_hash, 1) AS query_plan_hash,
    ${runtimeStatsColumns(metrics)}
FROM sys.query_store_runtime_stats AS rs
    JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    JOIN sys.query_store_plan AS p ON p.plan_id = rs.plan_id
WHERE p.query_id = @query_id
    AND rsi.start_time >= @counted_from${replicaFilter}
GROUP BY rs.plan_id, p.query_plan_hash;`;
    return runQueryStoreRead(reader, capabilities, options, {
        declarations: [
            `DECLARE @query_id bigint = ${sqlBigIntLiteral(request.queryId)};`,
            `DECLARE @plan_id bigint = ${sqlBigIntLiteral(request.planId)};`,
            `DECLARE @since datetimeoffset = ${sqlDateTimeOffsetLiteral(since)};`,
        ],
        body,
        map: ([windowSet, planSet, executionSet]) => {
            const window = toRecords(windowSet)[0] ?? {};
            const countedFrom = parseSqlDateTime(window.counted_from) ?? since;
            const serverTime = parseSqlDateTime(window.server_time);
            const found = toRecords(planSet).map(toPlanInfo)[0];
            const plan = found?.queryId === toIdText(request.queryId) ? found : undefined;
            const executions = toRecords(executionSet)
                .map((record): ForcedPlanExecution => {
                    const planId = readId(record, "plan_id") ?? "";
                    const planHash = readString(record, "query_plan_hash")?.trim();
                    return {
                        planId,
                        ...(planHash ? { planHash } : {}),
                        match:
                            planId === plan?.planId
                                ? "forcedPlan"
                                : planHash !== undefined &&
                                    planHash.toUpperCase() === plan?.planHash?.toUpperCase()
                                  ? "samePlanShape"
                                  : "otherPlan",
                        ...readRuntimeStats(record, metrics),
                    };
                })
                .sort((left, right) => right.executionCount - left.executionCount);
            return {
                countedFromUtc: countedFrom.toISOString(),
                outcome: verificationOutcome(
                    plan,
                    executions,
                    !!serverTime && serverTime.getTime() < countedFrom.getTime(),
                ),
                ...(plan ? { plan } : {}),
                executions,
            };
        },
    });
}

function readPlanForcingState(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    target: PlanChangeTarget,
    options: QueryStoreReadOptions | undefined,
): Promise<QueryStoreResult<PlanForcingState>> {
    const body = `SELECT SYSDATETIMEOFFSET() AS server_time;
SELECT
    ${planInfoColumns(capabilities)}
FROM sys.query_store_plan AS p
WHERE p.plan_id = @plan_id;
SELECT
    ${planInfoColumns(capabilities)}
FROM sys.query_store_plan AS p
WHERE p.query_id = @query_id AND p.is_forced_plan = 1;`;
    return runQueryStoreRead(reader, capabilities, options, {
        declarations: [
            `DECLARE @query_id bigint = ${sqlBigIntLiteral(target.queryId)};`,
            `DECLARE @plan_id bigint = ${sqlBigIntLiteral(target.planId)};`,
        ],
        body,
        // Query Store OFF is a blocker, not a status, so that the caller can show it.
        allStates: true,
        map: ([timeSet, planSet, forcedSet], queryStore) => {
            const plan = toRecords(planSet).map(toPlanInfo)[0];
            const serverTimeUtc = readDateTime(toRecords(timeSet)[0] ?? {}, "server_time");
            return {
                queryStore,
                ...(plan ? { plan } : {}),
                forcedPlans: toRecords(forcedSet).map(toPlanInfo),
                ...(serverTimeUtc ? { serverTimeUtc } : {}),
            };
        },
    });
}

function checkTarget(target: PlanChangeTarget): PlanChangeTarget {
    if (target?.kind !== "forcePlan" && target?.kind !== "unforcePlan") {
        throw new RangeError(`"${String(target?.kind)}" is not a plan change.`);
    }
    const queryId = toIdText(target.queryId);
    const planId = toIdText(target.planId);
    if (!queryId || !planId) {
        throw new RangeError("A plan change needs a query ID and a plan ID.");
    }
    return { kind: target.kind, queryId, planId };
}

/**
 * The values of a state that a change depends on. Execution times and failure counts change while
 * the query runs, so they are not part of it.
 */
function stateKey(state: PlanForcingState): string {
    const plan = (info: QueryStorePlanInfo | undefined) =>
        info
            ? [
                  info.planId,
                  info.queryId,
                  info.planHash ?? "",
                  info.isForced,
                  info.forcingType ?? "",
                  info.planType ?? "",
              ]
            : [];
    return JSON.stringify([
        state?.queryStore?.actualState ?? "",
        plan(state?.plan),
        (state?.forcedPlans ?? [])
            .map((forced) => `${forced.planId}:${forced.forcingType ?? ""}`)
            .sort(),
    ]);
}

function verificationOutcome(
    plan: QueryStorePlanInfo | undefined,
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
