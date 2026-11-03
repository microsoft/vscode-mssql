/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    QueryCategory,
    QueryStoreRanking,
    QueryStoreRuntimeStats,
    QueryStoreStatistic,
    RegressedQuery,
    TopQueries,
} from "../../../sharedInterfaces/performanceDashboard";

/** A row of a top queries list. */
export interface QueryListRow {
    readonly queryId: string;
    readonly queryText: string;
    readonly objectName?: string;
    /** The ranked statistic of the metric, in its unit (ms, KB), or the executions. */
    readonly value?: number;
    readonly executions: number;
    /** The value as a percent of a whole: all queries for a total, else the highest query. */
    readonly share?: number;
}

/** The categories of the Queries page, in the order of the picker. */
export const queryCategories: readonly QueryCategory[] = [
    "cpu",
    "memory",
    "duration",
    "executions",
    "reads",
    "regressed",
];

/** The categories that rank the queries of one period. */
export type RankedQueryCategory = Exclude<QueryCategory, "regressed">;

/** The category of a value from the location or the saved state, if it is one. */
export function toQueryCategory(value: string | undefined): QueryCategory | undefined {
    return queryCategories.find((category) => category === value);
}

export const queryCategoryRanking: Readonly<Record<RankedQueryCategory, QueryStoreRanking>> = {
    cpu: "cpuTime",
    duration: "duration",
    memory: "memoryGrant",
    executions: "executionCount",
    reads: "logicalReads",
};

export const rankStatistics: readonly QueryStoreStatistic[] = [
    "total",
    "avg",
    "max",
    "min",
    "stdev",
];

/**
 * Returns the rows of a top queries read. A total is a share of the total of all queries; other
 * statistics are not parts of a whole, so their share compares each query with the highest one.
 */
export function queryListRows(
    top: TopQueries | undefined,
    rankBy: QueryStoreRanking,
    statistic: QueryStoreStatistic,
): QueryListRow[] {
    if (!top) {
        return [];
    }
    const valueOf = (stats: QueryStoreRuntimeStats) =>
        rankBy === "executionCount" ? stats.executionCount : stats.metrics[rankBy]?.[statistic];
    const isTotal = rankBy === "executionCount" || statistic === "total";
    const whole = isTotal
        ? valueOf(top.workload)
        : top.queries.reduce((max, query) => Math.max(max, valueOf(query) ?? 0), 0);
    return top.queries.map((query) => {
        const value = valueOf(query);
        return {
            queryId: query.queryId,
            queryText: query.queryText,
            ...(query.objectName ? { objectName: query.objectName } : {}),
            ...(value !== undefined ? { value } : {}),
            executions: query.executionCount,
            ...(whole && value !== undefined ? { share: (value / whole) * 100 } : {}),
        };
    });
}

/** A row of the regressed queries. Its value is the added impact, and its executions the recent. */
export interface RegressedQueryRow extends QueryListRow {
    readonly recentAverage: number;
    readonly baselineAverage: number;
    readonly changePercent?: number;
    readonly newPlanCount: number;
}

/**
 * Returns the rows of a regressed queries read, which comes ranked. The added impact is not a
 * part of a whole, so its share compares each query with the first.
 */
export function regressedQueryRows(
    queries: readonly RegressedQuery[] | undefined,
): RegressedQueryRow[] {
    const highest = queries?.[0]?.addedImpact ?? 0;
    return (queries ?? []).map((query) => ({
        queryId: query.queryId,
        queryText: query.queryText,
        ...(query.objectName ? { objectName: query.objectName } : {}),
        value: query.addedImpact,
        executions: query.recentExecutionCount,
        ...(highest > 0 ? { share: (query.addedImpact / highest) * 100 } : {}),
        recentAverage: query.recentAverage,
        baselineAverage: query.baselineAverage,
        ...(query.changePercent !== undefined ? { changePercent: query.changePercent } : {}),
        newPlanCount: query.newPlanCount,
    }));
}

/** The rows that match the search, in the query ID or the text, and that are favorites if asked. */
export function filterQueryRows<TRow extends QueryListRow>(
    rows: readonly TRow[],
    search: string,
    favoriteQueryIds?: ReadonlySet<string>,
): TRow[] {
    const needle = search.trim().toLowerCase();
    return rows.filter(
        (row) =>
            (!favoriteQueryIds || favoriteQueryIds.has(row.queryId)) &&
            (!needle ||
                row.queryId.includes(needle) ||
                row.queryText.toLowerCase().includes(needle)),
    );
}
