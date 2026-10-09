/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import { SqlReader } from "../../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "../result";
import { QueryStoreColumnInfo } from "../queryStore/common/columnInfo";
import { resolveQueryConfigurationBase } from "../queryStore/common/configuration";
import {
    QueryStoreMetric,
    assertQueryStoreMetric,
    queryStoreMetrics,
} from "../queryStore/common/metric";
import {
    QueryStoreReadOnlyReason,
    QueryStoreOperationalStatus,
    getQueryStoreReadOnlyReason,
} from "../queryStore/common/operationalMode";
import {
    ReplicaGroupItem,
    availableReplicasQuery,
    mapAvailableReplicas,
} from "../queryStore/common/qdsMetadata";
import { replicaGroupIds } from "../queryStore/common/replicaGroup";
import { formatBigInt, formatInt } from "../queryStore/common/sqlParameters";
import {
    QueryStoreTimeInterval,
    DisplayTimeKind,
    resolveTimeInterval,
} from "../queryStore/common/timeInterval";
import {
    ForcedPlanQueriesConfiguration,
    forcedPlanQueriesSummary,
    getForcedPlanQueriesReportQuery,
} from "../queryStore/forcedPlanQueries";
import {
    HighVariationConfiguration,
    getHighVariationQueriesDetailedSummaryReportQuery,
    getHighVariationQueriesSummaryReportQuery,
    highVariationDetailedSummary,
    highVariationSummary,
} from "../queryStore/highVariation";
import {
    OverallResourceConsumptionConfiguration,
    getOverallResourceConsumptionReportQuery,
    overallResourceConsumption,
} from "../queryStore/overallResourceConsumption";
import {
    PlanSummaryConfiguration,
    getPlanSummaryChartViewQuery,
    getPlanSummaryGridViewQuery,
    planSummaryChartView,
    planSummaryGridView,
} from "../queryStore/planSummary";
import {
    QueryTextResult,
    getContainingObjectDefinitionQuery,
    getQueryTextQuery,
    getShowPlanXmlQuery,
    mapQueryTextRow,
    resolveQueryText,
} from "../queryStore/queryText";
import {
    TopResourceConsumersConfiguration,
    getTopResourceConsumersDetailedSummaryReportQuery,
    getTopResourceConsumersSummaryReportQuery,
    topResourceConsumersDetailedSummary,
    topResourceConsumersSummary,
} from "../queryStore/topResourceConsumers";
import { getTrackedQueriesReportQuery } from "../queryStore/trackedQueries";
import {
    QueryWaitStatsConfiguration,
    aggWaitTimePerQueryForWaitCategoryId,
    aggWaitTimePerWaitCategory,
    getAggWaitTimePerQueryForWaitCategoryReportQuery,
    getAggWaitTimePerWaitCategoryReportQuery,
    getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery,
} from "../queryStore/waitStats";
import { PerfRunOptions, readOptionsOf } from "../runOptions";
import { QueryStoreReport, ReportColumnSource, toQueryStoreReport } from "./reportData";
import {
    QueryStoreRunOptions,
    ReportOrderOptions,
    allMetricsMissing,
    metricColumn,
    queryStoreFamily,
    readQueryStoreProbe,
    readQueryStoreReport,
    replaceQueryBody,
    reportOutcome,
    requireReportOrder,
    resolveReportOrder,
    runWithQueryStore,
    unknownColumnError,
    unsupportedOutcome,
} from "./runContext";

/*
 * Run functions for the Query Store reports. Each one checks the platform and the Query Store
 * state, reads the metrics and the replica support, runs the generated query after the read
 * preamble, and maps the rows with the generator's column metadata. A configuration that is not
 * valid makes the function throw a `RangeError` before it reads.
 */

export type TopResourceConsumersRunConfig = Omit<
    TopResourceConsumersConfiguration,
    "isQdsRoAvailable"
> &
    ReportOrderOptions;

export type HighVariationRunConfig = Omit<HighVariationConfiguration, "isQdsRoAvailable"> &
    ReportOrderOptions;

export type OverallResourceConsumptionRunConfig = Omit<
    OverallResourceConsumptionConfiguration,
    "isQdsRoAvailable"
> &
    ReportOrderOptions;

export type ForcedPlanQueriesRunConfig = Omit<ForcedPlanQueriesConfiguration, "isQdsRoAvailable"> &
    ReportOrderOptions;

export type PlanSummaryRunConfig = Omit<PlanSummaryConfiguration, "isQdsRoAvailable">;

export type PlanSummaryGridRunConfig = PlanSummaryRunConfig & ReportOrderOptions;

/** The wait stats reports always read wait time. */
export type WaitStatsRunConfig = Omit<
    QueryWaitStatsConfiguration,
    "isQdsRoAvailable" | "selectedMetric" | "isExtendedDataForToolTipAvailable"
> &
    ReportOrderOptions;

export interface WaitStatsQueriesRunConfig extends WaitStatsRunConfig {
    /** `sys.query_store_wait_stats.wait_category`, for example from `getWaitCategoryInfo`. */
    readonly waitCategoryId: number;
}

export interface QueryWaitCategoriesRunConfig {
    readonly queryId: number | bigint | string;
    /** Default `{ option: "lastHour" }`. */
    readonly timeInterval?: QueryStoreTimeInterval;
    readonly replicaGroupId?: number | bigint | string;
    readonly displayTimeKind?: DisplayTimeKind;
}

export interface TrackedQueriesRunConfig {
    /** Text that the query text contains. `%` and `_` are `LIKE` wildcards. */
    readonly querySearchText: string;
}

/** The plan summary's default metric, like `PlanSummaryConfiguration.selectedMetric`. */
const planSummaryDefaultMetric: QueryStoreMetric = "cpuTime";

/**
 * Runs the Top Resource Consumers report: one row for each query, with the selected statistic of
 * the selected metric. Default order: that column, descending.
 */
export async function runTopResourceConsumersSummary(
    reader: SqlReader,
    info: PlatformInfo,
    config: TopResourceConsumersRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const base = resolveQueryConfigurationBase(config, { selectedStatistic: "total" });
    const prepare = (isQdsRoAvailable: boolean) => {
        const effective = { ...config, isQdsRoAvailable };
        const { columns } = topResourceConsumersSummary(effective);
        const order = requireReportOrder(
            columns,
            config,
            metricColumn(columns, base.selectedMetric, base.selectedStatistic),
        );
        const sql = getTopResourceConsumersSummaryReportQuery(
            effective,
            order.column?.id,
            order.descending,
            now,
        );
        return { columns, sql };
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes(base.selectedMetric)) {
                return unsupportedOutcome;
            }
            const { columns, sql } = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/**
 * Runs the detailed Top Resource Consumers report: one row for each query, with the selected
 * statistic of every available metric. Default order: the column of the selected metric,
 * descending.
 */
export async function runTopResourceConsumersDetailedSummary(
    reader: SqlReader,
    info: PlatformInfo,
    config: TopResourceConsumersRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const base = resolveQueryConfigurationBase(config, { selectedStatistic: "total" });
    return runDetailedReport(reader, info, config, options, base.selectedMetric, {
        columns: (metrics, effective) =>
            topResourceConsumersDetailedSummary(metrics, effective).columns,
        defaultColumn: (columns) =>
            metricColumn(columns, base.selectedMetric, base.selectedStatistic),
        sql: (metrics, effective, order, now) =>
            getTopResourceConsumersDetailedSummaryReportQuery(
                effective,
                metrics,
                order.column?.id,
                order.descending,
                now,
            ),
    });
}

/**
 * Runs the High Variation report: one row for each query, with the standard deviation and average
 * of the selected metric, and the variation when the statistic is `variation`. Default order: the
 * selected statistic, or else the standard deviation, descending.
 */
export async function runHighVariationSummary(
    reader: SqlReader,
    info: PlatformInfo,
    config: HighVariationRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const base = resolveQueryConfigurationBase(config, { selectedStatistic: "variation" });
    const prepare = (isQdsRoAvailable: boolean) => {
        const effective = { ...config, isQdsRoAvailable };
        const { columns } = highVariationSummary(effective);
        const order = requireReportOrder(
            columns,
            config,
            metricColumn(columns, base.selectedMetric, base.selectedStatistic),
        );
        const sql = getHighVariationQueriesSummaryReportQuery(
            effective,
            order.column?.id,
            order.descending,
            now,
        );
        return { columns, sql };
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes(base.selectedMetric)) {
                return unsupportedOutcome;
            }
            const { columns, sql } = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/**
 * Runs the detailed High Variation report: one row for each query, with the selected statistic of
 * every available metric. Default order: the column of the selected metric, descending.
 */
export async function runHighVariationDetailedSummary(
    reader: SqlReader,
    info: PlatformInfo,
    config: HighVariationRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const base = resolveQueryConfigurationBase(config, { selectedStatistic: "variation" });
    return runDetailedReport(reader, info, config, options, base.selectedMetric, {
        columns: (metrics, effective) => highVariationDetailedSummary(metrics, effective).columns,
        defaultColumn: (columns) =>
            metricColumn(columns, base.selectedMetric, base.selectedStatistic),
        sql: (metrics, effective, order, now) =>
            getHighVariationQueriesDetailedSummaryReportQuery(
                effective,
                metrics,
                order.column?.id,
                order.descending,
                now,
            ),
    });
}

/**
 * The minimum of `datetime`. The Overall Resource Consumption query casts the start of the window
 * to `datetime`, so a start before this fails. SSMS sends 0001-01-01 for All time, and its report
 * fails.
 */
const dateTimeMinimumMs = Date.UTC(1753, 0, 1);

/**
 * Runs the Overall Resource Consumption report: one row for each time bucket, with the total of
 * every available metric. Default order: `bucket_start`, ascending. When the configuration has
 * `selectedMetrics`, each one must be available. A window that starts before 1753-01-01, for
 * example `allTime`, starts at the oldest Query Store interval instead.
 */
export async function runOverallResourceConsumption(
    reader: SqlReader,
    info: PlatformInfo,
    config: OverallResourceConsumptionRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const window = config.specifiedTimeInterval
        ? resolveTimeInterval(config.specifiedTimeInterval, now)
        : undefined;
    const startsAtOldestInterval = !!window && window.start.getTime() < dateTimeMinimumMs;
    const prepare = (
        metrics: readonly QueryStoreMetric[],
        isQdsRoAvailable: boolean,
        specifiedTimeInterval = config.specifiedTimeInterval,
    ) => {
        const effective = { ...config, specifiedTimeInterval, isQdsRoAvailable };
        const { columns, sql: body } = overallResourceConsumption(
            metrics,
            effective,
            undefined,
            true,
            now,
        );
        const order = resolveReportOrder(
            columns,
            config,
            columns.find((column) => column.kind === "bucketStartTime"),
            false,
        );
        if (!order) {
            return undefined;
        }
        const ordered = overallResourceConsumption(
            metrics,
            effective,
            order.column,
            order.descending,
            now,
        ).sql;
        const batch = getOverallResourceConsumptionReportQuery(effective, metrics, now);
        return { columns, sql: replaceQueryBody(batch, body, ordered) };
    };
    if (!prepare(queryStoreMetrics, false)) {
        throw unknownColumnError(config);
    }

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        {
            metrics: true,
            replicaGroupId: config.replicaGroupId,
            oldestInterval: startsAtOldestInterval,
        },
        async (context) => {
            const metrics = context.probe.availableMetrics;
            // The query ranks the rows of each bucket by total duration.
            const requested = config.selectedMetrics ?? [];
            if (
                !metrics.includes("duration") ||
                requested.some((metric) => !metrics.includes(metric))
            ) {
                return unsupportedOutcome;
            }
            let specifiedTimeInterval = config.specifiedTimeInterval;
            if (window && startsAtOldestInterval) {
                const oldest = context.probe.oldestIntervalStart;
                if (!oldest || oldest.getTime() >= window.end.getTime()) {
                    // Query Store has no runtime stats in the window.
                    const empty = prepare(metrics, context.probe.isQdsRoAvailable);
                    return empty
                        ? reportOutcome(
                              toQueryStoreReport(empty.columns, undefined),
                              allMetricsMissing(context),
                          )
                        : unsupportedOutcome;
                }
                specifiedTimeInterval = { start: oldest, end: window.end };
            }
            const report = prepare(metrics, context.probe.isQdsRoAvailable, specifiedTimeInterval);
            if (!report) {
                return unsupportedOutcome;
            }
            return reportOutcome(
                await readQueryStoreReport(context, report.sql, report.columns),
                allMetricsMissing(context),
            );
        },
    );
}

/**
 * Runs the Forced Plans report: one row for each forced plan. Synapse dedicated pools do not have
 * plan forcing. Default order: the generator's default, `query_id` descending.
 */
export async function runForcedPlanQueries(
    reader: SqlReader,
    info: PlatformInfo,
    config: ForcedPlanQueriesRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const prepare = (isQdsRoAvailable: boolean) => {
        const effective = { ...config, isQdsRoAvailable };
        const { columns } = forcedPlanQueriesSummary(effective);
        const order = requireReportOrder(columns, config, columns[0]);
        // The facade sorts by the first column with a label, and two columns are named
        // last_execution_time. Keep its declarations and sort with the generator.
        const batch = getForcedPlanQueriesReportQuery(effective, undefined, order.descending);
        const body = forcedPlanQueriesSummary(effective, columns[0], order.descending).sql;
        const ordered = forcedPlanQueriesSummary(effective, order.column, order.descending).sql;
        return { columns, sql: replaceQueryBody(batch, body, ordered) };
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        options,
        { replicaGroupId: config.replicaGroupId, synapseDedicated: false },
        async (context) => {
            const { columns, sql } = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/** Runs the Tracked Queries search: up to 500 queries whose text contains the search text. */
export async function runTrackedQueries(
    reader: SqlReader,
    info: PlatformInfo,
    config: TrackedQueriesRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const sql = getTrackedQueriesReportQuery(config.querySearchText);
    const columns: ReportColumnSource[] = [
        { kind: "queryId", id: "query_id" },
        { kind: "queryTextId", id: "query_text_id" },
        { kind: "queryText", id: "query_sql_text" },
    ];
    return runWithQueryStore<QueryStoreReport>(reader, info, options, {}, async (context) =>
        reportOutcome(await readQueryStoreReport(context, sql, columns)),
    );
}

/**
 * Runs the plan summary chart of a query: one row for each plan, execution type, and time bucket,
 * with the statistics of the selected metric. Default metric: `cpuTime`.
 */
export async function runPlanSummaryChart(
    reader: SqlReader,
    info: PlatformInfo,
    config: PlanSummaryRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const metric = assertQueryStoreMetric(config.selectedMetric ?? planSummaryDefaultMetric);
    const prepare = (isQdsRoAvailable: boolean) => {
        const effective = { ...config, isQdsRoAvailable };
        const { columns } = planSummaryChartView(effective, "hour");
        return { columns, sql: getPlanSummaryChartViewQuery(effective, now) };
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes(metric)) {
                return unsupportedOutcome;
            }
            const { columns, sql } = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/**
 * Runs the plan summary grid of a query: one row for each plan and execution type, with the
 * statistics of the selected metric. Default metric: `cpuTime`. Default order: the generator's
 * default, `plan_id` descending. The execution count grid of a secondary replica is not supported,
 * because the generated SQL is not valid for it.
 */
export async function runPlanSummaryGrid(
    reader: SqlReader,
    info: PlatformInfo,
    config: PlanSummaryGridRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const metric = assertQueryStoreMetric(config.selectedMetric ?? planSummaryDefaultMetric);
    const isPrimary =
        formatBigInt(config.replicaGroupId ?? replicaGroupIds.primary) ===
        String(replicaGroupIds.primary);
    const prepare = (isQdsRoAvailable: boolean) => {
        const effective = { ...config, isQdsRoAvailable };
        const { columns } = planSummaryGridView(effective);
        const order = requireReportOrder(columns, config, columns[0]);
        const sql = getPlanSummaryGridViewQuery(effective, order.column?.id, order.descending, now);
        return { columns, sql };
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            if (
                !context.probe.availableMetrics.includes(metric) ||
                (metric === "executionCount" && !isPrimary)
            ) {
                return unsupportedOutcome;
            }
            const { columns, sql } = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/**
 * Runs the wait time of each wait category. Needs wait stats (SQL Server 2017 and later and the
 * Azure platforms). Default order: the selected statistic (default `total`), descending.
 */
export async function runWaitStatsByCategory(
    reader: SqlReader,
    info: PlatformInfo,
    config: WaitStatsRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const statistic = resolveQueryConfigurationBase(config, {
        selectedStatistic: "total",
    }).selectedStatistic;
    const prepare = (isQdsRoAvailable: boolean) => {
        const effective = { ...config, selectedMetric: "waitTime" as const, isQdsRoAvailable };
        const { columns } = aggWaitTimePerWaitCategory(effective);
        const order = requireReportOrder(
            columns,
            config,
            metricColumn(columns, "waitTime", statistic),
        );
        const sql = getAggWaitTimePerWaitCategoryReportQuery(
            effective,
            order.column?.id,
            order.descending,
            now,
        );
        return { columns, sql };
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes("waitTime")) {
                return unsupportedOutcome;
            }
            const { columns, sql } = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/**
 * Runs the wait time of each query in a wait category. Default order: the selected statistic
 * (default `total`), descending.
 */
export async function runWaitStatsQueriesForCategory(
    reader: SqlReader,
    info: PlatformInfo,
    config: WaitStatsQueriesRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    formatInt(config.waitCategoryId);
    const statistic = resolveQueryConfigurationBase(config, {
        selectedStatistic: "total",
    }).selectedStatistic;
    const prepare = (isQdsRoAvailable: boolean) => {
        const effective = { ...config, selectedMetric: "waitTime" as const, isQdsRoAvailable };
        const { columns } = aggWaitTimePerQueryForWaitCategoryId(effective);
        const order = requireReportOrder(
            columns,
            config,
            metricColumn(columns, "waitTime", statistic),
        );
        const sql = getAggWaitTimePerQueryForWaitCategoryReportQuery(
            effective,
            config.waitCategoryId,
            order.column?.id,
            order.descending,
            now,
        );
        return { columns, sql };
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes("waitTime")) {
                return unsupportedOutcome;
            }
            const { columns, sql } = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/**
 * Runs the total wait time of each wait category for one query, highest first. The C# tooltip of
 * a Top Resource Consumers row.
 */
export async function runQueryWaitCategories(
    reader: SqlReader,
    info: PlatformInfo,
    config: QueryWaitCategoriesRunConfig,
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const columns: ReportColumnSource[] = [
        { kind: "waitCategoryDesc", id: "WaitCategory" },
        { kind: "statisticMetric", id: "WaitTime", metric: "waitTime", statistic: "total" },
    ];
    const prepare = (isQdsRoAvailable: boolean) => {
        const sql = getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery(
            {
                selectedMetric: "waitTime",
                selectedStatistic: "total",
                timeInterval: config.timeInterval,
                replicaGroupId: config.replicaGroupId,
                displayTimeKind: config.displayTimeKind,
                isQdsRoAvailable,
            },
            config.queryId,
            now,
        );
        if (sql === undefined) {
            throw new Error("The wait category query is not available.");
        }
        return sql;
    };
    prepare(false);

    return runWithQueryStore<QueryStoreReport>(
        reader,
        info,
        { ...options, now },
        { metrics: true, replicaGroupId: config.replicaGroupId },
        async (context) => {
            if (!context.probe.availableMetrics.includes("waitTime")) {
                return unsupportedOutcome;
            }
            const sql = prepare(context.probe.isQdsRoAvailable);
            return reportOutcome(await readQueryStoreReport(context, sql, columns));
        },
    );
}

/**
 * Runs the text of a query. For a query in a module, the result has an `ALTER` script for the
 * module and where the query is in it. `noData` when Query Store does not have the query.
 */
export async function runQueryText(
    reader: SqlReader,
    info: PlatformInfo,
    config: { readonly queryId: number | bigint | string },
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<QueryTextResult>> {
    const sql = getQueryTextQuery(config.queryId);
    return runWithQueryStore<QueryTextResult>(reader, info, options, {}, async (context) => {
        const preamble = sessionPreamble(info, "read");
        const resultSets = await reader.read(`${preamble}\n${sql}`, context.readOptions);
        if (!resultSets[0]?.rows.length) {
            return { status: "noData" };
        }
        const row = mapQueryTextRow(resultSets);
        const definition =
            row.objectId === "0"
                ? undefined
                : await reader.read(
                      `${preamble}\n${getContainingObjectDefinitionQuery(row.objectId)}`,
                      context.readOptions,
                  );
        return { status: "ready", data: resolveQueryText(row, definition) };
    });
}

export interface PlanXml {
    /** A decimal string. */
    readonly planId: string;
    /** Showplan XML, as text. It can be large. */
    readonly queryPlan: string;
}

/** Runs the Showplan XML of a plan. `noData` when Query Store does not have the plan. */
export async function runPlanXml(
    reader: SqlReader,
    info: PlatformInfo,
    config: { readonly planId: number | bigint | string },
    options: QueryStoreRunOptions = {},
): Promise<PerfResult<PlanXml>> {
    const planId = formatBigInt(config.planId);
    const sql = getShowPlanXmlQuery(planId);
    return runWithQueryStore<PlanXml>(reader, info, options, {}, async (context) => {
        const [resultSet] = await reader.read(
            `${sessionPreamble(info, "read")}\n${sql}`,
            context.readOptions,
        );
        const queryPlan = resultSet?.rows[0]?.[0];
        return typeof queryPlan === "string" && queryPlan !== ""
            ? { status: "ready", data: { planId, queryPlan } }
            : { status: "noData" };
    });
}

/** What the Query Store reports can use on a database. */
export interface QueryStoreCapabilities {
    /** `actual_state`. `off` includes the error state. */
    readonly operationalStatus: QueryStoreOperationalStatus;
    /** Why Query Store is read-only, when it is. */
    readonly readOnlyReason?: QueryStoreReadOnlyReason;
    /**
     * The metrics that the reports can use. Pass them as `availableMetrics` to skip the probe in
     * later runs.
     */
    readonly availableMetrics: readonly QueryStoreMetric[];
    /** Query Store for secondary replicas. Pass it as `isQdsRoAvailable` in later runs. */
    readonly isQdsRoAvailable: boolean;
    /** The replica groups to report on. Empty without Query Store for secondary replicas. */
    readonly replicas: readonly ReplicaGroupItem[];
    /**
     * The start of the oldest runtime stats interval, ISO 8601 UTC: the oldest data that the
     * reports can show. Absent when Query Store has no interval.
     */
    readonly oldestIntervalStartUtc?: string;
}

/**
 * Reads the Query Store state, the metrics, and the replicas. `notConfigured` (with data) when
 * Query Store is OFF. Callers can cache `availableMetrics` and `isQdsRoAvailable` and pass them
 * to the run functions.
 */
export async function probeQueryStore(
    reader: SqlReader,
    info: PlatformInfo,
    options: PerfRunOptions = {},
): Promise<PerfResult<QueryStoreCapabilities>> {
    const now = options.now ?? new Date();
    const family = queryStoreFamily(info);
    if (!family) {
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
            { metrics: true, oldestInterval: true },
            {
                signal: options.signal,
                timeoutMs: options.timeoutMs,
            },
        );
        const status = probe.mode.operationalStatus;
        const replicas =
            probe.isQdsRoAvailable && status !== "off"
                ? mapAvailableReplicas(
                      await reader.read(
                          `${sessionPreamble(info, "read")}\n${availableReplicasQuery}`,
                          readOptionsOf(options),
                      ),
                  )
                : [];
        const readOnlyReason =
            status === "readOnly"
                ? getQueryStoreReadOnlyReason(probe.mode.readOnlyReason)
                : undefined;
        const data: QueryStoreCapabilities = {
            operationalStatus: status,
            ...(readOnlyReason !== undefined ? { readOnlyReason } : {}),
            availableMetrics: probe.availableMetrics,
            isQdsRoAvailable: probe.isQdsRoAvailable,
            replicas,
            ...(probe.oldestIntervalStart
                ? { oldestIntervalStartUtc: probe.oldestIntervalStart.toISOString() }
                : {}),
        };
        return {
            ...base,
            status: status === "off" ? "notConfigured" : "ready",
            data,
            missing: status === "readOnly" ? ["queryStoreReadOnly"] : [],
        };
    } catch (error) {
        return errorResult(info, error, now, "queryStore");
    }
}

interface DetailedReportDefinition<C> {
    columns(metrics: readonly QueryStoreMetric[], config: C): readonly QueryStoreColumnInfo[];
    defaultColumn(columns: readonly QueryStoreColumnInfo[]): QueryStoreColumnInfo | undefined;
    sql(
        metrics: readonly QueryStoreMetric[],
        config: C,
        order: { readonly column?: QueryStoreColumnInfo; readonly descending: boolean },
        now: Date,
    ): string;
}

/**
 * Runs a detailed report, which has a column for each available metric. A requested sort column
 * of a metric that the server does not record gives `unsupported`.
 */
async function runDetailedReport<
    C extends ReportOrderOptions & { readonly replicaGroupId?: number | bigint | string },
>(
    reader: SqlReader,
    info: PlatformInfo,
    config: C,
    options: QueryStoreRunOptions,
    selectedMetric: QueryStoreMetric,
    definition: DetailedReportDefinition<C & { isQdsRoAvailable: boolean }>,
): Promise<PerfResult<QueryStoreReport>> {
    const now = options.now ?? new Date();
    const prepare = (metrics: readonly QueryStoreMetric[], isQdsRoAvailable: boolean) => {
        const effective = { ...config, isQdsRoAvailable };
        const columns = definition.columns(metrics, effective);
        const order = resolveReportOrder(columns, config, definition.defaultColumn(columns));
        return order ? { columns, sql: definition.sql(metrics, effective, order, now) } : undefined;
    };
    if (!prepare(queryStoreMetrics, false)) {
        throw unknownColumnError(config);
    }

    return runWithQueryStore<QueryStoreReport>(
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
            return reportOutcome(
                await readQueryStoreReport(context, report.sql, report.columns),
                allMetricsMissing(context),
            );
        },
    );
}
