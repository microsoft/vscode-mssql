/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatSqlTemplate } from "./utils";

/**
 * An aggregation of a metric. Each value is also the name that generated column labels use, for
 * example `avg` in `avg_duration`.
 */
export type QueryStoreStatistic = "avg" | "min" | "max" | "stdev" | "last" | "total" | "variation";

/** Every statistic, in the order of the C# `Statistic` enum. */
export const queryStoreStatistics: readonly QueryStoreStatistic[] = [
    "avg",
    "min",
    "max",
    "stdev",
    "last",
    "total",
    "variation",
];

/*
 * Aggregation formulas over sys.query_store_runtime_stats. {0} is the statistic, {1} the metric,
 * {2} the stats table alias, and {3} a second statistic. "last" has no formula.
 */
const runtimeStatsFormulas: Readonly<Partial<Record<QueryStoreStatistic, string>>> = {
    avg: "CONVERT(float, SUM({2}.{0}_{1}*{2}.count_executions))/NULLIF(SUM({2}.count_executions), 0)",
    min: "CONVERT(float, MIN({2}.{0}_{1}))",
    max: "CONVERT(float, MAX({2}.{0}_{1}))",
    stdev: "CONVERT(float, SQRT( SUM({2}.{0}_{1}*{2}.{0}_{1}*{2}.count_executions)/NULLIF(SUM({2}.count_executions), 0)))",
    total: "CONVERT(float, SUM({2}.{0}_{1}*{2}.count_executions))",
    variation:
        "ISNULL(ROUND(CONVERT(float, (SQRT( SUM({2}.{0}_{1}*{2}.{0}_{1}*{2}.count_executions)/NULLIF(SUM({2}.count_executions), 0))*SUM({2}.count_executions)) / NULLIF(SUM({2}.{3}_{1}*{2}.count_executions), 0)),2), 0)",
};

/*
 * Aggregation formulas over sys.query_store_wait_stats. {0} is the wait stats table alias.
 * "variation" has no formula.
 */
const waitStatsFormulas: Readonly<Partial<Record<QueryStoreStatistic, string>>> = {
    avg: "CONVERT(float, SUM({0}.total_query_wait_time_ms)/SUM({0}.total_query_wait_time_ms/{0}.avg_query_wait_time_ms))",
    min: "CONVERT(float, MIN({0}.min_query_wait_time_ms))",
    max: "CONVERT(float, MAX({0}.max_query_wait_time_ms))",
    stdev: "CONVERT(float, SQRT( SUM({0}.stdev_query_wait_time_ms*{0}.stdev_query_wait_time_ms*({0}.total_query_wait_time_ms/{0}.avg_query_wait_time_ms))/SUM({0}.total_query_wait_time_ms/{0}.avg_query_wait_time_ms)))",
    last: "CONVERT(float, MIN({0}.last_query_wait_time))",
    total: "CONVERT(float, SUM({0}.total_query_wait_time_ms))",
};

export function isQueryStoreStatistic(value: unknown): value is QueryStoreStatistic {
    return typeof value === "string" && (queryStoreStatistics as readonly string[]).includes(value);
}

/**
 * Returns the statistic, or throws a `RangeError` when the value is not a statistic.
 */
export function assertQueryStoreStatistic(value: unknown): QueryStoreStatistic {
    if (!isQueryStoreStatistic(value)) {
        throw new RangeError(`"${String(value)}" is not a Query Store statistic.`);
    }
    return value;
}

/** C# `StatisticUtils.QueryString`. */
export function statisticQueryString(statistic: QueryStoreStatistic): string {
    return assertQueryStoreStatistic(statistic);
}

/**
 * Returns the formula for the statistic over `sys.query_store_runtime_stats`, with the arguments
 * in place. Throws a `RangeError` for `last`.
 */
export function getAggregationFormulaForRuntimeStats(
    statistic: QueryStoreStatistic,
    ...args: readonly string[]
): string {
    const formula = runtimeStatsFormulas[assertQueryStoreStatistic(statistic)];
    if (formula === undefined) {
        throw new RangeError(`Statistic "${statistic}" has no runtime stats formula.`);
    }
    return formatSqlTemplate(formula, ...args);
}

/**
 * Returns the formula for the statistic over `sys.query_store_wait_stats`, with the arguments in
 * place. Throws a `RangeError` for `variation`.
 */
export function getAggregationFormulaForWaitStats(
    statistic: QueryStoreStatistic,
    ...args: readonly string[]
): string {
    const formula = waitStatsFormulas[assertQueryStoreStatistic(statistic)];
    if (formula === undefined) {
        throw new RangeError(`Statistic "${statistic}" has no wait stats formula.`);
    }
    return formatSqlTemplate(formula, ...args);
}
