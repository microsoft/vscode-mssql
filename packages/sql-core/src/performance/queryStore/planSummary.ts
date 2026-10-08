/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryStoreColumnInfo,
    QueryStoreQuery,
    executionCountColumnInfo,
    simpleColumnInfo,
    statisticMetricColumnInfo,
} from "./common/columnInfo";
import { assertBoolean, queryStoreConstants } from "./common/configuration";
import { QueryStoreMetric, assertQueryStoreMetric, metricQueryString } from "./common/metric";
import {
    getRuntimeStatsSummary,
    getStatsViewAlias,
    getStatsViewName,
    queryStoreParameters,
} from "./common/queryGeneratorUtils";
import { getExecutionCountText } from "./common/queryTemplates";
import { replicaGroupIds } from "./common/replicaGroup";
import { replicaGroupIdParameter, withUsedParameters } from "./common/reportParameters";
import {
    QueryStoreSqlParameter,
    formatBigInt,
    getOrderByColumn,
    prependSqlParameters,
    timeIntervalParameters,
} from "./common/sqlParameters";
import { QueryStoreStatistic, assertQueryStoreStatistic } from "./common/statistic";
import {
    BucketInterval,
    DisplayTimeKind,
    QueryStoreTimeInterval,
    ResolvedTimeInterval,
    assertDisplayTimeKind,
    calculateGoodSubInterval,
    dateFunctionIntervalString,
    resolveTimeInterval,
} from "./common/timeInterval";
import { appendOrderBy } from "./common/utils";
import { getWaitStatsTableExpression } from "./common/waitStats";

/*
 * Port of PlanSummaryQueryGenerator, PlanSummaryConfiguration, PlanExecutionType, PlanKey,
 * TrackedQueriesConfiguration, the Plan Summary functions of QueryStoreQueryGenerator, and the
 * force and unforce calls of Utils from SQL Tools Service.
 */

/** C# `PlanSummaryConfiguration.PlanTimeIntervalMode`. */
export type PlanTimeIntervalMode = "specifiedRange" | "allHistory";

export interface PlanSummaryConfiguration {
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: number | bigint | string;
    /** Default 1, the primary replica. A `bigint`. */
    readonly replicaGroupId?: number | bigint | string;
    /** True when Query Store for secondary replicas exists. Default false. */
    readonly isQdsRoAvailable?: boolean;
    /** Default `"specifiedRange"`. */
    readonly timeIntervalMode?: PlanTimeIntervalMode;
    /**
     * Default `{ option: "last5Minutes" }`, the C# default of the `TimeInterval` struct. Used only
     * in `"specifiedRange"` mode.
     */
    readonly timeInterval?: QueryStoreTimeInterval;
    /** Default `"cpuTime"`, the C# default of the `Metric` enum. */
    readonly selectedMetric?: QueryStoreMetric;
    /** Default `"avg"`. The plan summary queries have every statistic, so it does not change them. */
    readonly selectedStatistic?: QueryStoreStatistic;
    /** Default `"utc"`. See {@link DisplayTimeKind}. */
    readonly displayTimeKind?: DisplayTimeKind;
}

/**
 * The Tracked Queries pane shows the plan summary of one query. C#
 * `TrackedQueriesConfiguration`, which has other defaults.
 */
export interface TrackedQueriesConfiguration extends Omit<PlanSummaryConfiguration, "queryId"> {
    /** Default 0, which is not a query. */
    readonly queryId?: number | bigint | string;
    /** Default `"duration"`. */
    readonly selectedMetric?: QueryStoreMetric;
    /** Default `{ option: "lastDay" }`. */
    readonly timeInterval?: QueryStoreTimeInterval;
    /** Seconds between refreshes. Default 5. The SQL does not use it. */
    readonly autoRefreshIntervalInSeconds?: number;
}

/** Applies the Tracked Queries defaults and returns a plan summary configuration. */
export function trackedQueriesPlanSummaryConfiguration(
    config: TrackedQueriesConfiguration = {},
): PlanSummaryConfiguration {
    return {
        ...config,
        queryId: config.queryId ?? queryStoreConstants.invalidQueryId,
        selectedMetric: config.selectedMetric ?? "duration",
        selectedStatistic: config.selectedStatistic ?? "avg",
        timeInterval: config.timeInterval ?? { option: "lastDay" },
        replicaGroupId: config.replicaGroupId ?? replicaGroupIds.primary,
    };
}

/** The execution type of a plan's runtime stats. `sys.query_store_runtime_stats.execution_type`. */
export type PlanExecutionType = "completed" | "canceled" | "failed" | "invalid";

/** The `execution_type` value of each type. `invalid` is a placeholder. */
export const planExecutionTypeIds: Readonly<Record<PlanExecutionType, number>> = {
    completed: 0,
    canceled: 3,
    failed: 4,
    invalid: 255,
};

/** Returns the type for an `execution_type` value, or `"invalid"`. */
export function planExecutionTypeFromId(id: number): PlanExecutionType {
    const entry = Object.entries(planExecutionTypeIds).find(([, value]) => value === id);
    return entry ? (entry[0] as PlanExecutionType) : "invalid";
}

/** A plan and an execution type. C# `PlanKey`. */
export interface PlanKey {
    /** A decimal string. */
    readonly planId: string;
    readonly executionType: PlanExecutionType;
}

/** Compares by plan ID, then by execution type ID. C# `PlanKey.CompareTo`. */
export function comparePlanKeys(left: PlanKey, right: PlanKey): number {
    const leftId = BigInt(formatBigInt(left.planId));
    const rightId = BigInt(formatBigInt(right.planId));
    if (leftId !== rightId) {
        return leftId < rightId ? -1 : 1;
    }
    return planExecutionTypeIds[left.executionType] - planExecutionTypeIds[right.executionType];
}

/** True for a key without a plan or execution type. C# `PlanKey.IsEmpty`. */
export function isEmptyPlanKey(key: PlanKey): boolean {
    return (
        formatBigInt(key.planId) === String(queryStoreConstants.invalidPlanId) ||
        key.executionType === "invalid"
    );
}

interface ResolvedConfiguration {
    readonly queryId: string;
    readonly replicaGroupId: string;
    readonly isPrimary: boolean;
    readonly isQdsRoAvailable: boolean;
    readonly useTimeInterval: boolean;
    readonly timeInterval: QueryStoreTimeInterval;
    readonly selectedMetric: QueryStoreMetric;
    readonly displayTimeKind: DisplayTimeKind;
}

const parameters = queryStoreParameters;

/**
 * Returns the query for the plan summary chart, with the `DECLARE` statements for its
 * parameters. The bucket is an hour, or depends on the length of the time interval in
 * `"specifiedRange"` mode. A relative time interval ends at `now`. C#
 * `QueryStoreQueryGenerator.GetPlanSummaryChartViewQuery`.
 */
export function getPlanSummaryChartViewQuery(
    config: PlanSummaryConfiguration,
    now: Date = new Date(),
): string {
    const configuration = resolveConfiguration(config);
    let bucketInterval: BucketInterval = "hour";
    let interval: ResolvedTimeInterval | undefined;
    if (configuration.useTimeInterval) {
        interval = resolveTimeInterval(configuration.timeInterval, now);
        bucketInterval = calculateGoodSubInterval(
            interval.end.getTime() - interval.start.getTime(),
        );
    }
    const { sql } = planSummaryChartView(config, bucketInterval);
    return prependSqlParameters(sql, reportParameters(configuration, sql, interval, now));
}

/**
 * Returns the query for the plan summary grid, with the `DECLARE` statements for its
 * parameters. C# `QueryStoreQueryGenerator.GetPlanSummaryGridViewQuery`.
 *
 * @param orderByColumnId The `id` of a column of {@link planSummaryGridView}. Default: the first
 * column.
 */
export function getPlanSummaryGridViewQuery(
    config: PlanSummaryConfiguration,
    orderByColumnId?: string,
    descending = true,
    now: Date = new Date(),
): string {
    const configuration = resolveConfiguration(config);
    const { columns } = planSummaryGridView(config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = planSummaryGridView(config, orderByColumn, descending);
    const interval = configuration.useTimeInterval
        ? resolveTimeInterval(configuration.timeInterval, now)
        : undefined;
    return prependSqlParameters(sql, reportParameters(configuration, sql, interval, now));
}

/**
 * Returns the query for the plan of a query and whether it is forced, with the `DECLARE`
 * statements for its parameters. C# `QueryStoreQueryGenerator.GetForcedPlanQuery`, which always
 * reads the primary replica. With a `replicaGroupId` other than the primary's, this port reads the
 * forcing of that replica.
 */
export function getForcedPlanQuery(
    queryId: number | bigint | string,
    planId: number | bigint | string,
    replicaGroupId: number | bigint | string = replicaGroupIds.primary,
): string {
    const replica = formatBigInt(replicaGroupId);
    const runForPrimary = replica === String(replicaGroupIds.primary);
    const result: QueryStoreSqlParameter[] = [
        { name: parameters.queryId, type: "bigint", value: queryId },
        { name: parameters.planId, type: "bigint", value: planId },
    ];
    if (!runForPrimary) {
        result.push(replicaGroupIdParameter(replica));
    }
    return prependSqlParameters(forcedPlanQuery(runForPrimary), result);
}

/** C# `PlanSummaryQueryGenerator.GetForcedPlanQuery`. */
export function forcedPlanQuery(runForPrimary: boolean): string {
    if (assertBoolean(runForPrimary)) {
        return `SELECT
    p.is_forced_plan,
    p.query_plan
FROM
    sys.query_store_plan p
WHERE
    p.query_id = ${parameters.queryId}
    AND p.plan_id = ${parameters.planId}`;
    }
    return `SELECT
    CONVERT(BIT, ISNULL(pfl.plan_forcing_location_id,0)) as is_forced_plan,
    p.query_plan
FROM
    sys.query_store_plan p
    LEFT OUTER JOIN sys.query_store_plan_forcing_locations pfl ON pfl.plan_id = p.plan_id
WHERE
    p.query_id = ${parameters.queryId}
    AND p.plan_id = ${parameters.planId}
    AND (pfl.replica_group_id = ${parameters.replicaGroupId} OR pfl.plan_forcing_location_id IS NULL)`;
}

/**
 * Returns the batch that forces the plan for the query. C# `Utils.ForcePlan`, which calls
 * `sys.sp_query_store_force_plan` as a stored procedure, and passes `@replica_group_id` unless it
 * is 0 (Query Store for secondary replicas is not available).
 */
export function getForcePlanQuery(
    queryId: number | bigint | string,
    planId: number | bigint | string,
    replicaGroupId: number | bigint | string = queryStoreConstants.replicaGroupIdUnavailable,
): string {
    return planForcingQuery("sys.sp_query_store_force_plan", queryId, planId, replicaGroupId);
}

/**
 * Returns the batch that stops forcing the plan for the query. C# `Utils.UnforcePlan`.
 */
export function getUnforcePlanQuery(
    queryId: number | bigint | string,
    planId: number | bigint | string,
    replicaGroupId: number | bigint | string = queryStoreConstants.replicaGroupIdUnavailable,
): string {
    return planForcingQuery("sys.sp_query_store_unforce_plan", queryId, planId, replicaGroupId);
}

/**
 * Returns the query for the plan summary chart without parameter declarations, and its columns.
 * C# `PlanSummaryQueryGenerator.PlanSummaryChartView`.
 */
export function planSummaryChartView(
    config: PlanSummaryConfiguration,
    timeIntervalBucket: BucketInterval,
): QueryStoreQuery {
    const configuration = resolveConfiguration(config);
    const metric = configuration.selectedMetric;
    const statsAlias = getStatsViewAlias(metric);
    const statsTableName = getStatsViewName(metric);
    const dateFunctionInterval = dateFunctionIntervalString(timeIntervalBucket);
    const timingConstraints = getTimingConstraints(configuration, statsAlias);

    if (metric === "executionCount") {
        return chartViewForExecutionCount(configuration, timingConstraints, dateFunctionInterval);
    }

    const columns: QueryStoreColumnInfo[] = [
        simpleColumnInfo("planId"),
        simpleColumnInfo("planForced"),
        simpleColumnInfo("executionType"),
        executionCountColumnInfo(),
        simpleColumnInfo("bucketStartTime"),
        simpleColumnInfo("bucketEndTime"),
        statisticMetricColumnInfo("avg", metric),
        statisticMetricColumnInfo("max", metric),
        statisticMetricColumnInfo("min", metric),
        statisticMetricColumnInfo("stdev", metric),
        statisticMetricColumnInfo("variation", metric),
        statisticMetricColumnInfo("total", metric),
    ];

    const waitstatsSubQuery =
        metric === "waitTime"
            ? getWaitStatsTableExpression(statsTableName, {
                  statisticList: ["avg", "min", "max", "stdev", "total"],
                  includeReplicaGroupId: configuration.isQdsRoAvailable,
                  includeQueryExecutionLastWaitTime: true,
                  addWithClause: false,
                  addSeparator: true,
              })
            : "";

    const replicaFilter = configuration.isQdsRoAvailable
        ? `            AND ${statsAlias}.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const sql = planChartSummaryTemplate(configuration.isPrimary, {
        metric: metricQueryString(metric),
        parameterQueryId: parameters.queryId,
        dateFunctionInterval,
        avg: getRuntimeStatsSummary("avg", metric, statsAlias),
        max: getRuntimeStatsSummary("max", metric, statsAlias),
        min: getRuntimeStatsSummary("min", metric, statsAlias),
        stdev: getRuntimeStatsSummary("stdev", metric, statsAlias),
        variation: getRuntimeStatsSummary("variation", metric, statsAlias),
        total: getRuntimeStatsSummary("total", metric, statsAlias),
        timingConstraints,
        parameterIntervalStartTime: parameters.intervalStartTime,
        waitstatsSubQuery,
        statsAlias,
        statsTableName,
        executionCountText: getExecutionCountText(metric, statsAlias),
        replica: configuration.isPrimary ? replicaFilter : parameters.replicaGroupId,
    });
    return { sql, columns };
}

/**
 * Returns the query for the plan summary grid without parameter declarations, and its columns.
 * Sorts by `orderByColumn` when it is set. C# `PlanSummaryQueryGenerator.PlanSummaryGridView`.
 */
export function planSummaryGridView(
    config: PlanSummaryConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
): QueryStoreQuery {
    const configuration = resolveConfiguration(config);
    const metric = configuration.selectedMetric;
    const statsAlias = getStatsViewAlias(metric);
    const statsTableName = getStatsViewName(metric);
    const timingConstraints = getTimingConstraints(configuration, statsAlias);

    if (metric === "executionCount") {
        return gridViewForExecutionCount(configuration, orderByColumn, descending);
    }

    const planIdColumn = simpleColumnInfo("planId");
    const planForcedColumn = simpleColumnInfo("planForced");
    const execTypeColumn = simpleColumnInfo("executionType");
    const execCountColumn = executionCountColumnInfo();
    const minMetricColumn = statisticMetricColumnInfo("min", metric);
    const maxMetricColumn = statisticMetricColumnInfo("max", metric);
    const avgMetricColumn = statisticMetricColumnInfo("avg", metric);
    const stdevMetricColumn = statisticMetricColumnInfo("stdev", metric);
    const variationMetricColumn = statisticMetricColumnInfo("variation", metric);
    const lastMetricColumn = statisticMetricColumnInfo("last", metric);
    const totalMetricColumn = statisticMetricColumnInfo("total", metric);
    const firstExecTimeColumn = simpleColumnInfo("firstExecTime");
    const lastExecTimeColumn = simpleColumnInfo("lastExecTime");
    const columns = [
        planIdColumn,
        planForcedColumn,
        execTypeColumn,
        execCountColumn,
        minMetricColumn,
        maxMetricColumn,
        avgMetricColumn,
        stdevMetricColumn,
        variationMetricColumn,
        lastMetricColumn,
        totalMetricColumn,
        firstExecTimeColumn,
        lastExecTimeColumn,
    ];

    const waitstatsSubQuery =
        metric === "waitTime"
            ? getWaitStatsTableExpression(statsTableName, {
                  statisticList: ["avg", "min", "max", "stdev", "total", "last"],
                  includeReplicaGroupId: configuration.isQdsRoAvailable,
                  includeQueryExecutionLastWaitTime: true,
                  addWithClause: false,
                  addSeparator: true,
              })
            : "";

    const sql = planGridSummaryTemplate({
        metric: metricQueryString(metric),
        parameterQueryId: parameters.queryId,
        planIdColumn: planIdColumn.id,
        planForcedColumn: planForcedColumn.id,
        minStatsSummary: getRuntimeStatsSummary("min", metric, statsAlias),
        minMetricColumn: minMetricColumn.id,
        maxStatsSummary: getRuntimeStatsSummary("max", metric, statsAlias),
        maxMetricColumn: maxMetricColumn.id,
        avgStatsSummary: getRuntimeStatsSummary("avg", metric, statsAlias),
        avgMetricColumn: avgMetricColumn.id,
        stdevStatsSummary: getRuntimeStatsSummary("stdev", metric, statsAlias),
        stdevMetricColumn: stdevMetricColumn.id,
        variationStatsSummary: getRuntimeStatsSummary("variation", metric, statsAlias),
        variationMetricColumn: variationMetricColumn.id,
        lastMetricColumn: lastMetricColumn.id,
        totalStatsSummary: getRuntimeStatsSummary("total", metric, statsAlias),
        totalMetricColumn: totalMetricColumn.id,
        firstExecTimeColumn: firstExecTimeColumn.id,
        lastExecTimeColumn: lastExecTimeColumn.id,
        timingConstraints,
        parameterIntervalStartTime: parameters.intervalStartTime,
        execTypeColumn: execTypeColumn.id,
        waitstatsSubQuery,
        statsTableName,
        statsAlias,
        executionCountText: getExecutionCountText(metric, statsAlias),
    });

    return { sql: appendOrderBy(sql, orderByColumn, { descending }), columns };
}

/** C# `PlanSummaryQueryGenerator.PlanSummaryChartViewForExecutionCount`. */
function chartViewForExecutionCount(
    configuration: ResolvedConfiguration,
    timingConstraints: string,
    dateFunctionInterval: string,
): QueryStoreQuery {
    const planIdColumn = simpleColumnInfo("planId");
    const planForcedColumn = simpleColumnInfo("planForced");
    const execTypeColumn = simpleColumnInfo("executionType");
    const execCountColumn = executionCountColumnInfo();
    const bucketStartColumn = simpleColumnInfo("bucketStartTime");
    const bucketEndColumn = simpleColumnInfo("bucketEndTime");
    const columns = [
        planIdColumn,
        planForcedColumn,
        execTypeColumn,
        execCountColumn,
        bucketStartColumn,
        bucketEndColumn,
    ];

    const replicaFilter = configuration.isQdsRoAvailable
        ? `        AND rs.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const execType = execTypeColumn.id;
    const sql = `WITH bucketizer as (
    SELECT
        rs.plan_id as plan_id,
        rs.${execType} as ${execType},
        SUM(rs.count_executions) as count_executions,
        DATEADD(${dateFunctionInterval}, ((DATEDIFF(${dateFunctionInterval}, 0, rs.last_execution_time))),0 ) as bucket_start,
        DATEADD(${dateFunctionInterval}, (1 + (DATEDIFF(${dateFunctionInterval}, 0, rs.last_execution_time))), 0) as bucket_end
      FROM
        sys.query_store_runtime_stats rs
        JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
      WHERE
        p.query_id = ${parameters.queryId}${timingConstraints}
${replicaFilter}
      GROUP BY
        rs.plan_id,
        rs.${execType},
        DATEDIFF(${dateFunctionInterval}, 0, rs.last_execution_time)
    ),
    is_forced as
    (
        SELECT is_forced_plan, plan_id
          FROM sys.query_store_plan
    )
SELECT b.plan_id as ${planIdColumn.id},
    is_forced_plan as ${planForcedColumn.id},
    ${execType} as ${execType},
    count_executions as ${execCountColumn.id},
    SWITCHOFFSET(bucket_start, DATEPART(tz, ${parameters.intervalStartTime})) as ${bucketStartColumn.id},
    SWITCHOFFSET(bucket_end, DATEPART(tz, ${parameters.intervalStartTime})) as ${bucketEndColumn.id}
FROM bucketizer b
JOIN is_forced f ON f.plan_id = b.plan_id`;
    return { sql, columns };
}

/**
 * C# `PlanSummaryQueryGenerator.PlanSummaryGridViewForExecutionCount`. It does not filter by the
 * time interval. For a replica other than the primary, the C# template puts the bare
 * `@replica_group_id` variable on its own line, which is not valid SQL. This port keeps it.
 */
function gridViewForExecutionCount(
    configuration: ResolvedConfiguration,
    orderByColumn: QueryStoreColumnInfo | undefined,
    descending: boolean,
): QueryStoreQuery {
    const planIdColumn = simpleColumnInfo("planId");
    const planForcedColumn = simpleColumnInfo("planForced");
    const execTypeColumn = simpleColumnInfo("executionType");
    const execCountColumn = executionCountColumnInfo();
    const firstExecTimeColumn = simpleColumnInfo("firstExecTime");
    const lastExecTimeColumn = simpleColumnInfo("lastExecTime");
    const columns = [
        planIdColumn,
        planForcedColumn,
        execTypeColumn,
        execCountColumn,
        firstExecTimeColumn,
        lastExecTimeColumn,
    ];

    const replicaFilter = configuration.isQdsRoAvailable
        ? ` AND rs.replica_group_id = ${parameters.replicaGroupId}`
        : "";
    const replica = configuration.isPrimary ? replicaFilter : parameters.replicaGroupId;
    const planForced = configuration.isPrimary
        ? `    MAX(CONVERT(int, p.is_forced_plan)) ${planForcedColumn.id},`
        : `    MAX(CASE WHEN pf.plan_forcing_location_id IS NOT NULL THEN 1 ELSE 0 END) ${planForcedColumn.id},`;
    const forcingJoin = configuration.isPrimary
        ? ""
        : `
LEFT OUTER JOIN
    sys.query_store_plan_forcing_locations pf on pf.plan_id = rs.plan_id`;
    const execType = execTypeColumn.id;

    const sql = `SELECT p.${planIdColumn.id},
${planForced}
    SUM(distinct rs.${execType}) ${execType},
    ROUND(${getRuntimeStatsSummary("total", "executionCount", "rs")}, 2) ${execCountColumn.id},
    MIN(rs.${firstExecTimeColumn.id}) ${firstExecTimeColumn.id},
    MAX(rs.${lastExecTimeColumn.id}) ${lastExecTimeColumn.id}
FROM
    sys.query_store_runtime_stats rs
JOIN
    sys.query_store_plan p ON p.plan_id = rs.plan_id${forcingJoin}
WHERE p.query_id = ${parameters.queryId}
${replica}
GROUP BY p.plan_id, rs.execution_type`;

    return { sql: appendOrderBy(sql, orderByColumn, { descending }), columns };
}

/** `\n        AND NOT (...)` in `"specifiedRange"` mode. C# `PlanChartQueryTiming`. */
function getTimingConstraints(configuration: ResolvedConfiguration, statsAlias: string): string {
    return configuration.useTimeInterval
        ? `\n        AND NOT (${statsAlias}.first_execution_time > ${parameters.intervalEndTime} OR ${statsAlias}.last_execution_time < ${parameters.intervalStartTime})`
        : "";
}

/**
 * `@query_id`, the interval in `"specifiedRange"` mode, and then the variables that the SQL uses
 * but the C# code does not declare: `@interval_start_time` in `"allHistory"` mode (the queries
 * read its time zone offset, so this port sets it to `now`), and `@replica_group_id`.
 */
function reportParameters(
    configuration: ResolvedConfiguration,
    sql: string,
    interval: ResolvedTimeInterval | undefined,
    now: Date,
): QueryStoreSqlParameter[] {
    const result: QueryStoreSqlParameter[] = [
        { name: parameters.queryId, type: "bigint", value: configuration.queryId },
    ];
    if (interval) {
        result.push(
            ...timeIntervalParameters(
                parameters.intervalStartTime,
                parameters.intervalEndTime,
                interval,
                configuration.displayTimeKind,
            ),
        );
    }
    return withUsedParameters(sql, result, [
        {
            name: parameters.intervalStartTime,
            type: "datetimeoffset",
            value: now,
            displayTimeKind: configuration.displayTimeKind,
        },
        replicaGroupIdParameter(configuration.replicaGroupId),
    ]);
}

function planForcingQuery(
    procedure: string,
    queryId: number | bigint | string,
    planId: number | bigint | string,
    replicaGroupId: number | bigint | string,
): string {
    const replica = formatBigInt(replicaGroupId);
    const result: QueryStoreSqlParameter[] = [
        { name: parameters.queryId, type: "bigint", value: queryId },
        { name: parameters.planId, type: "bigint", value: planId },
    ];
    let call = `EXEC ${procedure} ${parameters.queryId} = ${parameters.queryId}, ${parameters.planId} = ${parameters.planId}`;
    if (replica !== String(queryStoreConstants.replicaGroupIdUnavailable)) {
        result.push(replicaGroupIdParameter(replica));
        call += `, ${parameters.replicaGroupId} = ${parameters.replicaGroupId}`;
    }
    return prependSqlParameters(`${call};`, result);
}

function resolveConfiguration(config: PlanSummaryConfiguration): ResolvedConfiguration {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    const replicaGroupId = formatBigInt(config.replicaGroupId ?? replicaGroupIds.primary);
    const timeIntervalMode = config.timeIntervalMode ?? "specifiedRange";
    if (timeIntervalMode !== "specifiedRange" && timeIntervalMode !== "allHistory") {
        throw new RangeError(`"${String(timeIntervalMode)}" is not a time interval mode.`);
    }
    assertQueryStoreStatistic(config.selectedStatistic ?? "avg");
    return {
        queryId: formatBigInt(config.queryId),
        replicaGroupId,
        isPrimary: replicaGroupId === String(replicaGroupIds.primary),
        isQdsRoAvailable: assertBoolean(config.isQdsRoAvailable ?? false),
        useTimeInterval: timeIntervalMode === "specifiedRange",
        timeInterval: config.timeInterval ?? { option: "last5Minutes" },
        selectedMetric: assertQueryStoreMetric(config.selectedMetric ?? "cpuTime"),
        displayTimeKind: assertDisplayTimeKind(config.displayTimeKind ?? "utc"),
    };
}

interface ChartTemplateValues {
    readonly metric: string;
    readonly parameterQueryId: string;
    readonly dateFunctionInterval: string;
    readonly avg: string;
    readonly max: string;
    readonly min: string;
    readonly stdev: string;
    readonly variation: string;
    readonly total: string;
    readonly timingConstraints: string;
    readonly parameterIntervalStartTime: string;
    readonly waitstatsSubQuery: string;
    readonly statsAlias: string;
    readonly statsTableName: string;
    readonly executionCountText: string;
    /** The replica filter for the primary, or the replica group variable for a secondary. */
    readonly replica: string;
}

/**
 * C# `QueryTemplates.PlanChartSummaryPrimaryTemplate` and `PlanChartSummarySecondaryTemplate`.
 * The `bucketizer as ` line ends with a space in the C# templates.
 */
function planChartSummaryTemplate(isPrimary: boolean, v: ChartTemplateValues): string {
    const m = v.metric;
    const a = v.statsAlias;
    const d = v.dateFunctionInterval;
    const bucketizer = `WITH ${v.waitstatsSubQuery}
    bucketizer as${" "}
    (
        SELECT
            ${a}.plan_id as plan_id,
            ${a}.execution_type as execution_type,
        ${v.executionCountText}
            DATEADD(${d}, ((DATEDIFF(${d}, 0, ${a}.last_execution_time))),0 ) as bucket_start,
            DATEADD(${d}, (1 + (DATEDIFF(${d}, 0, ${a}.last_execution_time))), 0) as bucket_end,
            ${v.avg} as avg_${m},
            ${v.max} as max_${m},
            ${v.min} as min_${m},
            ${v.stdev} as stdev_${m},
            ${v.variation} as variation_${m},
            ${v.total} as total_${m}
        FROM
            ${v.statsTableName} ${a}
            JOIN sys.query_store_plan p ON p.plan_id = ${a}.plan_id
        WHERE
            p.query_id = ${v.parameterQueryId}${v.timingConstraints}
${isPrimary ? v.replica : `            AND ${a}.replica_group_id = ${v.replica}`}
        GROUP BY
            ${a}.plan_id,
            ${a}.execution_type,
            DATEDIFF(${d}, 0, ${a}.last_execution_time)
    ),`;
    const forcing = isPrimary
        ? `
    is_forced as
    (
        SELECT is_forced_plan, plan_id
          FROM sys.query_store_plan
    )
SELECT b.plan_id as plan_id,
    is_forced_plan,`
        : `
    forcing_decisions as
    (
        SELECT plan_forcing_location_id, plan_id
          FROM sys.query_store_plan_forcing_locations
          WHERE replica_group_id = ${v.replica}
    )
SELECT b.plan_id as plan_id,
    CONVERT(BIT, ISNULL(plan_forcing_location_id,0)) as is_forced_plan,`;
    const join = isPrimary
        ? "JOIN is_forced f ON f.plan_id = b.plan_id"
        : "LEFT OUTER JOIN forcing_decisions f ON f.plan_id = b.plan_id";
    return `${bucketizer}${forcing}
    execution_type,
    count_executions,
    SWITCHOFFSET(bucket_start, DATEPART(tz, ${v.parameterIntervalStartTime})) AS bucket_start,
    SWITCHOFFSET(bucket_end, DATEPART(tz, ${v.parameterIntervalStartTime})) AS bucket_end,
    avg_${m},
    max_${m},
    min_${m},
    stdev_${m},
    variation_${m},
    total_${m}
FROM bucketizer b
${join}`;
}

interface GridTemplateValues {
    readonly metric: string;
    readonly parameterQueryId: string;
    readonly planIdColumn: string;
    readonly planForcedColumn: string;
    readonly minStatsSummary: string;
    readonly minMetricColumn: string;
    readonly maxStatsSummary: string;
    readonly maxMetricColumn: string;
    readonly avgStatsSummary: string;
    readonly avgMetricColumn: string;
    readonly stdevStatsSummary: string;
    readonly stdevMetricColumn: string;
    readonly variationStatsSummary: string;
    readonly variationMetricColumn: string;
    readonly lastMetricColumn: string;
    readonly totalStatsSummary: string;
    readonly totalMetricColumn: string;
    readonly firstExecTimeColumn: string;
    readonly lastExecTimeColumn: string;
    readonly timingConstraints: string;
    readonly parameterIntervalStartTime: string;
    readonly execTypeColumn: string;
    readonly waitstatsSubQuery: string;
    readonly statsTableName: string;
    readonly statsAlias: string;
    readonly executionCountText: string;
}

/**
 * C# `QueryTemplates.GeneratePlanGridSummaryTemplate`. The C# template also takes the replica
 * group variable, but does not use it.
 */
function planGridSummaryTemplate(v: GridTemplateValues): string {
    const a = v.statsAlias;
    return `WITH ${v.waitstatsSubQuery}
    last_table AS
    (
        SELECT
            p.plan_id plan_id,
            first_value(${a}.last_${v.metric}) OVER (PARTITION BY p.plan_id ORDER BY ${a}.last_execution_time DESC) last_value
        FROM
            ${v.statsTableName} ${a}
        JOIN
            sys.query_store_plan p ON p.plan_id = ${a}.plan_id
        WHERE
            p.query_id = ${v.parameterQueryId}
    )
SELECT p.${v.planIdColumn},
    MAX(CONVERT(int, p.is_forced_plan)) ${v.planForcedColumn},
    SUM(distinct ${a}.${v.execTypeColumn}) ${v.execTypeColumn},
${v.executionCountText}
    ROUND(${v.minStatsSummary}, 2) ${v.minMetricColumn},
    ROUND(${v.maxStatsSummary}, 2) ${v.maxMetricColumn},
    ROUND(${v.avgStatsSummary}, 2) ${v.avgMetricColumn},
    ROUND(${v.stdevStatsSummary}, 2) ${v.stdevMetricColumn},
    ROUND(${v.variationStatsSummary}, 2) ${v.variationMetricColumn},
    ROUND(max(l.last_value), 2) ${v.lastMetricColumn},
    ROUND(${v.totalStatsSummary}, 2) ${v.totalMetricColumn},
    SWITCHOFFSET(MIN(${a}.${v.firstExecTimeColumn}), DATEPART(tz, ${v.parameterIntervalStartTime})) ${v.firstExecTimeColumn},
    SWITCHOFFSET(MAX(${a}.${v.lastExecTimeColumn}), DATEPART(tz, ${v.parameterIntervalStartTime})) ${v.lastExecTimeColumn}
FROM
    ${v.statsTableName} ${a}
JOIN
    sys.query_store_plan p ON p.plan_id = ${a}.plan_id
JOIN
    last_table l ON p.plan_id = l.plan_id
WHERE p.query_id = ${v.parameterQueryId}${v.timingConstraints}
GROUP BY p.plan_id, ${a}.execution_type`;
}
