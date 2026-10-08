/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryStoreMetric, assertQueryStoreMetric, metricQueryString } from "./metric";
import { QueryStoreStatistic, assertQueryStoreStatistic, statisticQueryString } from "./statistic";
import { ComparisonTimeInterval, comparisonTimeIntervalQueryString } from "./timeInterval";

/**
 * The kind of a report column. Each kind is a C# `ColumnInfo` class. Callers show localized
 * header text for each kind. Some kinds share a label, for example `lastExecTime` and
 * `lastQueryExecTime`.
 */
export type QueryStoreColumnKind =
    | "queryId"
    | "objectId"
    | "objectName"
    | "queryText"
    | "planId"
    | "executionType"
    | "waitCategoryDesc"
    | "waitCategoryId"
    | "numPlans"
    | "forcedPlanFailureCount"
    | "forcedPlanId"
    | "forcedPlanFailureDescription"
    | "lastCompileStartTime"
    | "lastForcedPlanExecTime"
    | "lastQueryExecTime"
    | "planForced"
    | "firstExecTime"
    | "lastExecTime"
    | "bucketStartTime"
    | "bucketEndTime"
    | "executionCount"
    | "statisticMetric"
    | "statisticMetricTime"
    | "statisticMetricRegression";

/** A kind with a fixed label. */
export type QueryStoreSimpleColumnKind = Exclude<
    QueryStoreColumnKind,
    "executionCount" | "statisticMetric" | "statisticMetricTime" | "statisticMetricRegression"
>;

export interface QueryStoreColumnInfo {
    readonly kind: QueryStoreColumnKind;
    /**
     * The column label in the generated query and in the result set. Pass it as
     * `orderByColumnId` to sort by the column.
     */
    readonly id: string;
    /** Set for the `statisticMetric*` kinds. */
    readonly statistic?: QueryStoreStatistic;
    /** Set for the `statisticMetric*` kinds. */
    readonly metric?: QueryStoreMetric;
    /** Set for `executionCount` and `statisticMetricTime`. */
    readonly timeInterval?: ComparisonTimeInterval;
    /**
     * True when the column has more data to read for each row, such as the wait categories behind
     * total wait time. Set for the `statisticMetric*` kinds.
     */
    readonly bindRuntimeData?: boolean;
}

/** A generated query and its columns, in result set order. */
export interface QueryStoreQuery {
    readonly sql: string;
    readonly columns: QueryStoreColumnInfo[];
}

const simpleColumnLabels: Readonly<Record<QueryStoreSimpleColumnKind, string>> = {
    queryId: "query_id",
    objectId: "object_id",
    objectName: "object_name",
    queryText: "query_sql_text",
    planId: "plan_id",
    executionType: "execution_type",
    waitCategoryDesc: "wait_category_desc",
    waitCategoryId: "wait_category",
    numPlans: "num_plans",
    forcedPlanFailureCount: "force_failure_count",
    forcedPlanId: "plan_id",
    forcedPlanFailureDescription: "last_force_failure_reason_desc",
    lastCompileStartTime: "last_compile_start_time",
    lastForcedPlanExecTime: "last_execution_time",
    lastQueryExecTime: "last_execution_time",
    planForced: "is_forced_plan",
    firstExecTime: "first_execution_time",
    lastExecTime: "last_execution_time",
    bucketStartTime: "bucket_start",
    bucketEndTime: "bucket_end",
};

/** A column with a fixed label, such as `queryId` (`query_id`). */
export function simpleColumnInfo(kind: QueryStoreSimpleColumnKind): QueryStoreColumnInfo {
    if (!Object.prototype.hasOwnProperty.call(simpleColumnLabels, kind)) {
        throw new RangeError(`"${String(kind)}" is not a simple column kind.`);
    }
    return { kind, id: simpleColumnLabels[kind] };
}

/**
 * The execution count column: `count_executions`, or `count_executions_recent` and
 * `count_executions_hist` for a comparison window.
 */
export function executionCountColumnInfo(
    timeInterval: ComparisonTimeInterval = "none",
): QueryStoreColumnInfo {
    const label = metricQueryString("executionCount");
    return {
        kind: "executionCount",
        id:
            timeInterval === "none"
                ? label
                : `${label}_${comparisonTimeIntervalQueryString(timeInterval)}`,
        timeInterval,
    };
}

/** A statistic of a metric, labeled `{statistic}_{metric}`, for example `avg_duration`. */
export function statisticMetricColumnInfo(
    statistic: QueryStoreStatistic,
    metric: QueryStoreMetric,
    bindRuntimeData = false,
): QueryStoreColumnInfo {
    return {
        kind: "statisticMetric",
        id: `${statisticQueryString(statistic)}_${metricQueryString(metric)}`,
        statistic,
        metric,
        bindRuntimeData,
    };
}

/**
 * A statistic of a metric in a comparison window, labeled `{statistic}_{metric}_{window}`, for
 * example `avg_duration_recent`.
 */
export function statisticMetricTimeColumnInfo(
    statistic: QueryStoreStatistic,
    metric: QueryStoreMetric,
    timeInterval: ComparisonTimeInterval,
    bindRuntimeData = false,
): QueryStoreColumnInfo {
    return {
        kind: "statisticMetricTime",
        id: `${statisticQueryString(statistic)}_${metricQueryString(metric)}_${comparisonTimeIntervalQueryString(timeInterval)}`,
        statistic,
        metric,
        timeInterval,
        bindRuntimeData,
    };
}

/**
 * The regression of a metric: `additional_{metric}_workload` for `total`, and
 * `{metric}_regr_perc_recent` for the other statistics.
 */
export function statisticMetricRegressionColumnInfo(
    statistic: QueryStoreStatistic,
    metric: QueryStoreMetric,
    bindRuntimeData = false,
): QueryStoreColumnInfo {
    const metricLabel = metricQueryString(metric);
    return {
        kind: "statisticMetricRegression",
        id:
            assertQueryStoreStatistic(statistic) === "total"
                ? `additional_${metricLabel}_workload`
                : `${metricLabel}_regr_perc_recent`,
        statistic,
        metric,
        bindRuntimeData,
    };
}

/** The index of the first column of the kind, or -1. C# `ColumnInfoUtils.GetColumnIndex`. */
export function getColumnIndex(
    columns: readonly QueryStoreColumnInfo[],
    kind: QueryStoreColumnKind,
): number {
    return columns.findIndex((column) => column.kind === kind);
}

/**
 * Returns the sort column for a new metric and statistic selection. C#
 * `ColumnInfoUtils.UpdateColumnInfo`, which changes the column in place.
 */
export function updateColumnInfo(
    column: QueryStoreColumnInfo,
    metric: QueryStoreMetric,
    statistic: QueryStoreStatistic,
): QueryStoreColumnInfo {
    assertQueryStoreMetric(metric);
    assertQueryStoreStatistic(statistic);
    if (metric === "executionCount" && statistic === "total") {
        return executionCountColumnInfo();
    }
    switch (column.kind) {
        case "executionCount":
        case "numPlans":
            return statisticMetricColumnInfo(statistic, metric);
        case "statisticMetric":
            return statisticMetricColumnInfo(statistic, metric, column.bindRuntimeData);
        case "statisticMetricTime":
            return statisticMetricTimeColumnInfo(
                statistic,
                metric,
                column.timeInterval ?? "none",
                column.bindRuntimeData,
            );
        case "statisticMetricRegression":
            return statisticMetricRegressionColumnInfo(statistic, metric, column.bindRuntimeData);
        default:
            return column;
    }
}
