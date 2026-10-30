/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    QueryStoreRanking,
    QueryStoreRuntimeStats,
    QueryStoreStatistic,
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

/** The categories of the Queries page, and what each one ranks by. */
export type QueryCategory = "cpu" | "duration" | "memory" | "executions" | "reads";

export const queryCategories: readonly QueryCategory[] = [
    "cpu",
    "memory",
    "duration",
    "executions",
    "reads",
];

export const queryCategoryRanking: Readonly<Record<QueryCategory, QueryStoreRanking>> = {
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
