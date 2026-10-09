/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    QueryStoreMetric,
    QueryStoreReport,
    QueryStoreStatistic,
    ReportColumn,
    ReportRow,
} from "../../../sharedInterfaces/performance";

/** A row of a top queries list. */
export interface QueryListRow {
    readonly queryId: string;
    readonly queryText: string;
    readonly objectName?: string;
    /** The ranked statistic of the metric, in the report's unit (ms, KB), or the executions. */
    readonly value?: number;
    readonly executions: number;
    readonly planCount?: number;
    /** The value as a percent of a whole, such as the CPU capacity of the range. */
    readonly share?: number;
}

/**
 * Returns the rows of a Top Resource Consumers report. The value is the report's statistic
 * column, or the execution count for the executions report. With `whole`, each row has its
 * value as a percent of it.
 */
export function queryListRows(
    report: QueryStoreReport | undefined,
    whole?: number,
): QueryListRow[] {
    const idColumn = findColumn(report, (column) => column.kind === "queryId");
    const textColumn = findColumn(report, (column) => column.kind === "queryText");
    const objectColumn = findColumn(report, (column) => column.kind === "objectName");
    const executionsColumn = findColumn(report, (column) => column.kind === "executionCount");
    const plansColumn = findColumn(report, (column) => column.kind === "numPlans");
    const valueColumn =
        findColumn(report, (column) => column.kind === "statisticMetric") ?? executionsColumn;
    if (!report || !idColumn) {
        return [];
    }
    return report.rows.map((row) => {
        const value = valueColumn ? numberOf(row, valueColumn) : undefined;
        const objectName = objectColumn ? String(row[objectColumn.id] ?? "") : "";
        return {
            queryId: String(row[idColumn.id] ?? ""),
            queryText: textColumn ? String(row[textColumn.id] ?? "") : "",
            ...(objectName ? { objectName } : {}),
            ...(value !== undefined ? { value } : {}),
            executions: executionsColumn ? (numberOf(row, executionsColumn) ?? 0) : 0,
            ...(plansColumn ? { planCount: numberOf(row, plansColumn) } : {}),
            ...(whole && value !== undefined ? { share: (value / whole) * 100 } : {}),
        };
    });
}

/** The categories of the Queries view, and the metric that each one ranks by. */
export type QueryCategory = "cpu" | "duration" | "executions" | "reads";

export const queryCategories: readonly QueryCategory[] = ["cpu", "duration", "executions", "reads"];

export const queryCategoryMetrics: Readonly<Record<QueryCategory, QueryStoreMetric>> = {
    cpu: "cpuTime",
    duration: "duration",
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

function findColumn(
    report: QueryStoreReport | undefined,
    predicate: (column: ReportColumn) => boolean,
): ReportColumn | undefined {
    return report?.columns.find(predicate);
}

function numberOf(row: ReportRow, column: ReportColumn): number | undefined {
    const value = Number(row[column.id]);
    return Number.isFinite(value) ? value : undefined;
}
