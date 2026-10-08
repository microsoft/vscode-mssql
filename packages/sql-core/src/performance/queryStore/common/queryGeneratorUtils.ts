/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryStoreMetric,
    assertQueryStoreMetric,
    metricConversionFactor,
    metricQueryString,
    metricRoundOffPoints,
} from "./metric";
import {
    QueryStoreStatistic,
    assertQueryStoreStatistic,
    getAggregationFormulaForRuntimeStats,
    getAggregationFormulaForWaitStats,
    statisticQueryString,
} from "./statistic";
import { assertSqlAlias, formatSqlTemplate } from "./utils";

/** The T-SQL variables that the generated queries use. */
export const queryStoreParameters = {
    queryId: "@query_id",
    planId: "@plan_id",
    resultsRowCount: "@results_row_count",
    intervalStartTime: "@interval_start_time",
    intervalEndTime: "@interval_end_time",
    waitCategoryId: "@wait_category",
    replicaGroupId: "@replica_group_id",
} as const;

/** `ROUND({value}*{conversionFactor},{roundOffPoints})`. */
export const conversionTemplate = "ROUND({0}*{1},{2})";

/**
 * Returns the column expression for a statistic of a metric over `sys.query_store_runtime_stats`
 * or another table with the same columns. For example, `total` of `logicalReads` is
 * `ROUND(CONVERT(float, SUM(rs.avg_logical_io_reads*rs.count_executions))*8,2)`.
 *
 * `executionCount` is always a sum. `variation` is not converted or rounded. Throws a `RangeError`
 * for `last`.
 */
export function getRuntimeStatsSummary(
    statistic: QueryStoreStatistic,
    metric: QueryStoreMetric,
    statsTableName: string,
): string {
    assertQueryStoreStatistic(statistic);
    assertQueryStoreMetric(metric);
    assertSqlAlias(statsTableName);

    if (metric === "executionCount") {
        return formatSqlTemplate(
            "CONVERT(float, SUM({0}.{1}))",
            statsTableName,
            metricQueryString(metric),
        );
    }

    let summary: string;
    switch (statistic) {
        case "avg":
        case "min":
        case "max":
        case "stdev":
            summary = getAggregationFormulaForRuntimeStats(
                statistic,
                statisticQueryString(statistic),
                metricQueryString(metric),
                statsTableName,
            );
            break;
        case "total":
            // The total uses the average of each interval.
            summary = getAggregationFormulaForRuntimeStats(
                statistic,
                statisticQueryString("avg"),
                metricQueryString(metric),
                statsTableName,
            );
            break;
        case "variation":
            return getAggregationFormulaForRuntimeStats(
                statistic,
                statisticQueryString("stdev"),
                metricQueryString(metric),
                statsTableName,
                statisticQueryString("avg"),
            );
        default:
            throw new RangeError(
                `Statistic "${statistic}" is not supported for metric "${metric}" in runtime stats.`,
            );
    }

    return formatSqlTemplate(
        conversionTemplate,
        summary,
        metricConversionFactor(metric),
        metricRoundOffPoints(metric),
    );
}

/**
 * Returns the column expression for a statistic of wait time over `sys.query_store_wait_stats`.
 * Throws a `RangeError` for `variation`.
 */
export function getWaitStatsSummary(
    statistic: QueryStoreStatistic,
    statsTableName: string,
): string {
    assertQueryStoreStatistic(statistic);
    assertSqlAlias(statsTableName);

    let summary: string;
    switch (statistic) {
        case "avg":
        case "min":
        case "max":
        case "stdev":
        case "total":
        case "last":
            summary = getAggregationFormulaForWaitStats(statistic, statsTableName);
            break;
        default:
            throw new RangeError(`Statistic "${statistic}" is not supported for wait stats.`);
    }

    return formatSqlTemplate(
        conversionTemplate,
        summary,
        metricConversionFactor("waitTime"),
        metricRoundOffPoints("waitTime"),
    );
}

/**
 * The view to read a metric from: `sys.query_store_runtime_stats`, or `wait_stats` for wait time.
 * `wait_stats` is the name of the common table expression that the wait stats queries define.
 */
export function getStatsViewName(metric: QueryStoreMetric): string {
    return assertQueryStoreMetric(metric) === "waitTime"
        ? "wait_stats"
        : "sys.query_store_runtime_stats";
}

/** The alias of the stats view: `ws` for wait time, and `rs` for the other metrics. */
export function getStatsViewAlias(metric: QueryStoreMetric): string {
    return assertQueryStoreMetric(metric) === "waitTime" ? "ws" : "rs";
}

/** `TOP (@results_row_count)`, or empty when the query returns all rows. */
export function rowsToReturnString(returnAllQueries: boolean): string {
    return returnAllQueries ? "" : `TOP (${queryStoreParameters.resultsRowCount})`;
}
