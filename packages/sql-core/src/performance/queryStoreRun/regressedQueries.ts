/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlBigIntLiteral } from "../../common/literals";
import { PlatformInfo } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import {
    SqlReadError,
    SqlReader,
    readId,
    readString,
    toIdText,
    toRecords,
} from "../../common/sqlReader";
import { MissingDataCode, PerfResult } from "../result";
import { QueryStoreColumnInfo } from "../queryStore/common/columnInfo";
import { resolveQueryConfigurationBase } from "../queryStore/common/configuration";
import { QueryStoreMetric, queryStoreMetrics } from "../queryStore/common/metric";
import { queryStoreParameters } from "../queryStore/common/queryGeneratorUtils";
import { replicaGroupIdParameter } from "../queryStore/common/reportParameters";
import {
    QueryStoreSqlParameter,
    prependSqlParameters,
    timeIntervalParameters,
} from "../queryStore/common/sqlParameters";
import { resolveTimeInterval } from "../queryStore/common/timeInterval";
import {
    RegressedQueriesConfiguration,
    getRegressedQueriesDetailedSummaryReportQuery,
    getRegressedQueriesSummaryReportQuery,
    regressedQueriesParameters,
    regressedQueryDetailedSummary,
    regressedQuerySummary,
} from "../queryStore/regressedQueries";
import { QueryStoreReport, normalizeQueryPlanHash } from "./reportData";
import {
    QueryStoreRunContext,
    QueryStoreRunOptions,
    ReportOrderOptions,
    ResolvedReportOrder,
    allMetricsMissing,
    metricColumn,
    readQueryStoreReport,
    replaceQueryBody,
    resolveReportOrder,
    runWithQueryStore,
    unknownColumnError,
    unsupportedOutcome,
} from "./runContext";

export type RegressedQueriesRunConfig = Omit<RegressedQueriesConfiguration, "isQdsRoAvailable"> &
    ReportOrderOptions;

/** The plans that a query ran with in one window. */
export interface RegressedPlanWindow {
    /** The number of distinct `plan_id` values. */
    readonly planCount: number;
    /** Distinct `plan_id` values, as decimal strings, in ascending order. */
    readonly planIds: readonly string[];
    /** Distinct `query_plan_hash` values, as `0x` hex, in ascending order. */
    readonly planHashes: readonly string[];
}

/** How the plans of a regressed query changed between the history and the recent window. */
export interface RegressedPlanChange {
    readonly queryId: string;
    /**
     * True when the recent window has a plan shape (`query_plan_hash`) that the history window
     * does not have. A recompile to the same shape with a new `plan_id` is not a new plan. False
     * when `baselinePlanRetained` is false, because there is nothing to compare.
     */
    readonly newPlan: boolean;
    /**
     * False when Query Store has no plan that ran in the history window, for example because
     * cleanup or `sp_query_store_remove_plan` removed it.
     */
    readonly baselinePlanRetained: boolean;
    /** The recent plan shapes that the history window does not have. */
    readonly newPlanHashes: readonly string[];
    /** The baseline window. */
    readonly history: RegressedPlanWindow;
    /** The current window. */
    readonly recent: RegressedPlanWindow;
}

export interface RegressedQueriesReport extends QueryStoreReport {
    /**
     * One entry for each row, in row order. Not set when the plan read failed; then `missing` has
     * `regressedPlanChanges`.
     */
    readonly planChanges?: readonly RegressedPlanChange[];
}

/** The most query IDs in one statement of the plan read. */
const queryIdsPerStatement = 500;

/**
 * Runs the Regressed Queries report, which compares a recent window with a history window, and
 * then reads the plans of the returned queries to set {@link RegressedPlanChange}. Default order:
 * the regression of the selected metric, descending.
 */
export async function runRegressedQueriesSummary(
    reader: SqlReader,
    info: PlatformInfo,
    config: RegressedQueriesRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<RegressedQueriesReport>> {
    const base = resolveQueryConfigurationBase(config, { selectedStatistic: "total" });
    return runRegressedReport(reader, info, config, options, base.selectedMetric, {
        query: (_metrics, effective, orderColumn, descending) =>
            regressedQuerySummary(effective, orderColumn, descending),
        batch: (_metrics, effective, now) => getRegressedQueriesSummaryReportQuery(effective, now),
        allMetrics: false,
    });
}

/**
 * Runs the detailed Regressed Queries report, which has every available metric except the
 * execution count, and then reads the plans like {@link runRegressedQueriesSummary}. Default
 * order: the regression of the selected metric, descending.
 */
export async function runRegressedQueriesDetailedSummary(
    reader: SqlReader,
    info: PlatformInfo,
    config: RegressedQueriesRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<RegressedQueriesReport>> {
    const base = resolveQueryConfigurationBase(config, { selectedStatistic: "total" });
    return runRegressedReport(reader, info, config, options, base.selectedMetric, {
        query: (metrics, effective, orderColumn, descending) =>
            regressedQueryDetailedSummary(metrics, effective, orderColumn, descending),
        batch: (metrics, effective, now) =>
            getRegressedQueriesDetailedSummaryReportQuery(effective, metrics, now),
        allMetrics: true,
    });
}

/**
 * Returns the batch that lists, for each query and window, the plans that ran in the window,
 * with the window filter of the report: `NOT (rs.first_execution_time > @end OR
 * rs.last_execution_time < @start)`. Each statement has up to 500 query IDs. Exported for tests.
 */
export function buildRegressedPlanChangesQuery(
    info: PlatformInfo,
    config: RegressedQueriesRunConfig,
    queryIds: readonly string[],
    isQdsRoAvailable: boolean,
    now: Date,
): string {
    if (queryIds.length === 0) {
        throw new RangeError("The plan read needs at least one query ID.");
    }
    const base = resolveQueryConfigurationBase(config, { selectedStatistic: "total" });
    const p = regressedQueriesParameters;
    // The defaults of RegressedQueriesConfiguration.
    const recent = resolveTimeInterval(config.timeIntervalRecent ?? { option: "lastHour" }, now);
    const history = resolveTimeInterval(config.timeIntervalHistory ?? { option: "lastWeek" }, now);
    const parameters: QueryStoreSqlParameter[] = [
        ...timeIntervalParameters(p.recentStartTime, p.recentEndTime, recent, base.displayTimeKind),
        ...timeIntervalParameters(
            p.historyStartTime,
            p.historyEndTime,
            history,
            base.displayTimeKind,
        ),
    ];
    if (isQdsRoAvailable) {
        parameters.push(replicaGroupIdParameter(base.replicaGroupId));
    }
    const replicaFilter = isQdsRoAvailable
        ? `\n            AND rs.replica_group_id = ${queryStoreParameters.replicaGroupId}`
        : "";

    const statements: string[] = [];
    for (let start = 0; start < queryIds.length; start += queryIdsPerStatement) {
        const ids = queryIds
            .slice(start, start + queryIdsPerStatement)
            .map((id) => sqlBigIntLiteral(id))
            .join(", ");
        statements.push(`SELECT
    CONVERT(varchar(20), p.query_id) AS query_id,
    w.time_window,
    CONVERT(varchar(20), p.plan_id) AS plan_id,
    CONVERT(varchar(18), p.query_plan_hash, 1) AS query_plan_hash
FROM sys.query_store_plan AS p
CROSS JOIN (VALUES
    (N'history', ${p.historyStartTime}, ${p.historyEndTime}),
    (N'recent', ${p.recentStartTime}, ${p.recentEndTime})) AS w (time_window, start_time, end_time)
WHERE p.query_id IN (${ids})
    AND EXISTS (
        SELECT 1
        FROM sys.query_store_runtime_stats AS rs
        WHERE rs.plan_id = p.plan_id
            AND NOT (rs.first_execution_time > w.end_time OR rs.last_execution_time < w.start_time)${replicaFilter}
    );`);
    }
    return `${sessionPreamble(info, "read")}\n${prependSqlParameters(statements.join("\n"), parameters)}`;
}

/** A plan that ran in a window. */
export interface RegressedPlanRow {
    readonly queryId: string;
    readonly timeWindow: "history" | "recent";
    readonly planId: string;
    /** `0x` hex. Undefined when the plan has no hash. */
    readonly queryPlanHash?: string;
}

/**
 * Compares the plans of each query between the windows. Plan shapes are compared by
 * `query_plan_hash`, not by `plan_id`.
 */
export function computeRegressedPlanChanges(
    queryIds: readonly string[],
    plans: readonly RegressedPlanRow[],
): RegressedPlanChange[] {
    return queryIds.map((queryId) => {
        const forQuery = plans.filter((plan) => plan.queryId === queryId);
        const history = planWindow(forQuery.filter((plan) => plan.timeWindow === "history"));
        const recent = planWindow(forQuery.filter((plan) => plan.timeWindow === "recent"));
        const baselinePlanRetained = history.planCount > 0;
        const historyHashes = new Set(history.planHashes);
        const newPlanHashes = baselinePlanRetained
            ? recent.planHashes.filter((hash) => !historyHashes.has(hash))
            : [];
        return {
            queryId,
            newPlan: newPlanHashes.length > 0,
            baselinePlanRetained,
            newPlanHashes,
            history,
            recent,
        };
    });
}

interface RegressedReportDefinition<C> {
    query(
        metrics: readonly QueryStoreMetric[],
        config: C,
        orderColumn?: QueryStoreColumnInfo,
        descending?: boolean,
    ): { readonly sql: string; readonly columns: QueryStoreColumnInfo[] };
    batch(metrics: readonly QueryStoreMetric[], config: C, now: Date): string;
    /** True for the detailed report, which has every available metric. */
    readonly allMetrics: boolean;
}

async function runRegressedReport(
    reader: SqlReader,
    info: PlatformInfo,
    config: RegressedQueriesRunConfig,
    options: QueryStoreRunOptions,
    selectedMetric: QueryStoreMetric,
    definition: RegressedReportDefinition<
        RegressedQueriesRunConfig & { readonly isQdsRoAvailable: boolean }
    >,
): Promise<PerfResult<RegressedQueriesReport>> {
    const now = options.now ?? new Date();
    const prepare = (metrics: readonly QueryStoreMetric[], isQdsRoAvailable: boolean) => {
        const effective = { ...config, isQdsRoAvailable };
        const { columns, sql: body } = definition.query(metrics, effective);
        const order: ResolvedReportOrder | undefined = resolveReportOrder(
            columns,
            config,
            metricColumn(
                columns,
                selectedMetric,
                resolveQueryConfigurationBase(config, { selectedStatistic: "total" })
                    .selectedStatistic,
                "statisticMetricRegression",
            ),
        );
        if (!order) {
            return undefined;
        }
        // The facade declares the parameters but does not sort.
        const ordered = definition.query(metrics, effective, order.column, order.descending).sql;
        return {
            columns,
            sql: replaceQueryBody(definition.batch(metrics, effective, now), body, ordered),
        };
    };
    if (!prepare(queryStoreMetrics, false)) {
        throw unknownColumnError(config);
    }

    return runWithQueryStore<RegressedQueriesReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            const metrics = context.probe.availableMetrics;
            const report = metrics.includes(selectedMetric)
                ? prepare(metrics, context.probe.isQdsRoAvailable)
                : undefined;
            if (!report) {
                return unsupportedOutcome;
            }
            const data = await readQueryStoreReport(context, report.sql, report.columns);
            const missing: MissingDataCode[] = definition.allMetrics
                ? allMetricsMissing(context)
                : [];
            if (data.rows.length === 0) {
                return { status: "noData", data: { ...data, planChanges: [] }, missing };
            }
            const planChanges = await readPlanChanges(context, config, data, options);
            if (!planChanges) {
                missing.push("regressedPlanChanges");
            }
            return {
                status: "ready",
                data: planChanges ? { ...data, planChanges } : data,
                missing,
            };
        },
    );
}

/** Reads the plans of the returned queries. Returns undefined when the read fails. */
async function readPlanChanges(
    context: QueryStoreRunContext,
    config: RegressedQueriesRunConfig,
    report: QueryStoreReport,
    options: QueryStoreRunOptions,
): Promise<RegressedPlanChange[] | undefined> {
    const idColumn = report.columns.find((column) => column.kind === "queryId");
    const queryIds = report.rows.map((row) => toIdText(idColumn ? row[idColumn.id] : "") ?? "");
    try {
        const sql = buildRegressedPlanChangesQuery(
            context.info,
            config,
            [...new Set(queryIds.filter((id) => id !== ""))],
            context.probe.isQdsRoAvailable,
            context.now,
        );
        const resultSets = await context.reader.read(sql, context.readOptions);
        const plans = resultSets.flatMap((resultSet) =>
            toRecords(resultSet).flatMap((record): RegressedPlanRow[] => {
                const queryId = readId(record, "query_id");
                const planId = readId(record, "plan_id");
                const timeWindow = readString(record, "time_window");
                if (!queryId || !planId || (timeWindow !== "history" && timeWindow !== "recent")) {
                    return [];
                }
                const queryPlanHash = normalizeQueryPlanHash(readString(record, "query_plan_hash"));
                return [{ queryId, timeWindow, planId, queryPlanHash }];
            }),
        );
        return computeRegressedPlanChanges(queryIds, plans);
    } catch (error) {
        // A cancel stops the run. Any other failure leaves out only the plan change flags.
        if (
            options.signal?.aborted ||
            (error instanceof SqlReadError && error.kind === "canceled")
        ) {
            throw error;
        }
        return undefined;
    }
}

function planWindow(plans: readonly RegressedPlanRow[]): RegressedPlanWindow {
    const planIds = [...new Set(plans.map((plan) => plan.planId))].sort(compareDecimal);
    const planHashes = [
        ...new Set(plans.flatMap((plan) => (plan.queryPlanHash ? [plan.queryPlanHash] : []))),
    ].sort();
    return { planCount: planIds.length, planIds, planHashes };
}

function compareDecimal(left: string, right: string): number {
    const difference = BigInt(left) - BigInt(right);
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
