/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * The numbers of the overview's CPU view. CPU use is estimated from Query Store: the CPU time of
 * the captured queries divided by the elapsed time and the cores (vCores or logical CPUs). Without
 * the core count, it is the average number of busy cores.
 */

import type {
    DatabaseFacts,
    MetricWindowTotal,
    QueryStoreReport,
    ReportColumn,
    ReportRow,
} from "../../../sharedInterfaces/performance";
import type { TimeWindowParams } from "../../../sharedInterfaces/performanceDashboard";
import type { ResolvedTimeRange } from "../../common/timeRange/timeRange";

const dayMs = 24 * 60 * 60 * 1000;
/** A guard against a bucket size that would give too many points. */
const maxChartPoints = 5000;

/**
 * The cores that CPU use is measured against: the vCores, else the logical CPUs of SQL Server.
 * Undefined when neither is above 0, for example on the Basic, S0, and S1 tiers.
 */
export function cpuCoreCount(facts: DatabaseFacts | undefined): number | undefined {
    for (const count of [facts?.vCores, facts?.logicalCpus]) {
        if (count !== undefined && count > 0) {
            return count;
        }
    }
    return undefined;
}

/**
 * The windows of the CPU summary, in this order: the selected range, the last 24 hours, the 24
 * hours before, the last 7 days, and the 7 days before.
 */
export function cpuSummaryWindows(range: ResolvedTimeRange, now: Date): TimeWindowParams[] {
    const end = now.getTime();
    const window = (start: number, stop: number) => ({
        startUtc: new Date(start).toISOString(),
        endUtc: new Date(stop).toISOString(),
    });
    return [
        window(range.from.getTime(), range.to.getTime()),
        window(end - dayMs, end),
        window(end - 2 * dayMs, end - dayMs),
        window(end - 7 * dayMs, end),
        window(end - 14 * dayMs, end - 7 * dayMs),
    ];
}

export interface CpuSummary {
    /** The average CPU use in the range, in percent of the cores. Set when the cores are known. */
    readonly averagePercent?: number;
    /** The average number of busy cores in the range. Set when the cores are not known. */
    readonly averageBusyCores?: number;
    /**
     * The change of CPU use, in percent: the last 24 hours against the 24 hours before. Absent
     * when Query Store has no data for all of the earlier window, or the earlier window used no
     * CPU.
     */
    readonly change24Hours?: number;
    /** The change of CPU use, in percent: the last 7 days against the 7 days before. */
    readonly change7Days?: number;
}

/**
 * Returns the CPU summary from the totals of {@link cpuSummaryWindows}. The range starts at the
 * oldest Query Store data when it is later, so that the time without data does not lower the
 * average.
 */
export function cpuSummary(
    windows: readonly MetricWindowTotal[],
    cores: number | undefined,
    availableFrom: Date | undefined,
): CpuSummary {
    const [range, last24Hours, previous24Hours, last7Days, previous7Days] = windows;
    let average: Pick<CpuSummary, "averagePercent" | "averageBusyCores"> = {};
    if (range) {
        const start = Math.max(Date.parse(range.startUtc), availableFrom?.getTime() ?? -Infinity);
        const elapsedMs = Date.parse(range.endUtc) - start;
        if (elapsedMs > 0) {
            const busyCores = range.total / elapsedMs;
            average = cores
                ? { averagePercent: (busyCores / cores) * 100 }
                : { averageBusyCores: busyCores };
        }
    }
    return withValues({
        ...average,
        change24Hours: relativeChange(last24Hours, previous24Hours, availableFrom),
        change7Days: relativeChange(last7Days, previous7Days, availableFrom),
    });
}

/**
 * The change from the previous window to the current one, in percent. Undefined when Query
 * Store has no data for the start of the previous window, or the previous window used none.
 */
export function relativeChange(
    current: MetricWindowTotal | undefined,
    previous: MetricWindowTotal | undefined,
    availableFrom: Date | undefined,
): number | undefined {
    if (!current || !previous || previous.total <= 0) {
        return undefined;
    }
    if (availableFrom && Date.parse(previous.startUtc) < availableFrom.getTime()) {
        return undefined;
    }
    return ((current.total - previous.total) / previous.total) * 100;
}

export interface CpuChartPoint {
    readonly x: Date;
    /** Percent of the cores, or busy cores when the cores are not known. */
    readonly y: number;
}

/**
 * Returns a point for each time bucket of an Overall Resource Consumption report, from the oldest
 * data or the start of the range to its end. A bucket without rows used no CPU.
 */
export function cpuChartPoints(
    report: QueryStoreReport | undefined,
    range: ResolvedTimeRange,
    availableFrom: Date | undefined,
    cores: number | undefined,
): CpuChartPoint[] {
    const startColumn = findColumn(report, (column) => column.kind === "bucketStartTime");
    const endColumn = findColumn(report, (column) => column.kind === "bucketEndTime");
    const cpuColumn = findColumn(report, isTotalCpuColumn);
    if (!report || !startColumn || !endColumn || !cpuColumn || report.rows.length === 0) {
        return [];
    }
    const buckets = new Map<number, number>();
    let sizeMs = 0;
    for (const row of report.rows) {
        const start = Date.parse(String(row[startColumn.id]));
        const end = Date.parse(String(row[endColumn.id]));
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
            continue;
        }
        sizeMs = sizeMs || end - start;
        buckets.set(start, (buckets.get(start) ?? 0) + numberOf(row, cpuColumn));
    }
    if (sizeMs <= 0) {
        return [];
    }
    const anchor = buckets.keys().next().value as number;
    const first = Math.max(range.from.getTime(), availableFrom?.getTime() ?? -Infinity);
    const points: CpuChartPoint[] = [];
    for (
        let start = anchor + Math.floor((first - anchor) / sizeMs) * sizeMs;
        start < range.to.getTime() && points.length < maxChartPoints;
        start += sizeMs
    ) {
        const busyCores = (buckets.get(start) ?? 0) / sizeMs;
        points.push({ x: new Date(start), y: cores ? (busyCores / cores) * 100 : busyCores });
    }
    return points;
}

/**
 * The length of the time buckets of an Overall Resource Consumption report, in milliseconds.
 * Undefined when the report has no buckets.
 */
export function cpuBucketMs(report: QueryStoreReport | undefined): number | undefined {
    const startColumn = findColumn(report, (column) => column.kind === "bucketStartTime");
    const endColumn = findColumn(report, (column) => column.kind === "bucketEndTime");
    if (!report || !startColumn || !endColumn) {
        return undefined;
    }
    for (const row of report.rows) {
        const sizeMs =
            Date.parse(String(row[endColumn.id])) - Date.parse(String(row[startColumn.id]));
        if (sizeMs > 0) {
            return sizeMs;
        }
    }
    return undefined;
}

export interface TopQueryRow {
    readonly queryId: string;
    readonly queryText: string;
    /**
     * The CPU use of the query, in percent of the cores over the range: the same estimate as the
     * summary, so the queries add up to its average. Set when the cores are known.
     */
    readonly cpuPercent?: number;
    /** Total CPU time, in milliseconds. */
    readonly totalCpuMs: number;
    /** CPU time per execution, in milliseconds. */
    readonly cpuPerExecutionMs?: number;
    readonly executions: number;
}

/**
 * The CPU time that the range had, in milliseconds: the elapsed time from the oldest data or
 * the start of the range, times the cores. Undefined without the cores.
 */
export function cpuCapacityMs(
    range: ResolvedTimeRange,
    availableFrom: Date | undefined,
    cores: number | undefined,
): number | undefined {
    if (!cores) {
        return undefined;
    }
    const start = Math.max(range.from.getTime(), availableFrom?.getTime() ?? -Infinity);
    const elapsedMs = range.to.getTime() - start;
    return elapsedMs > 0 ? elapsedMs * cores : undefined;
}

/**
 * Returns the rows of a Top Resource Consumers report of total CPU time. With the CPU capacity
 * of the range ({@link cpuCapacityMs}), each row has its CPU use in percent.
 */
export function topQueryRows(
    report: QueryStoreReport | undefined,
    capacityMs?: number,
): TopQueryRow[] {
    const idColumn = findColumn(report, (column) => column.kind === "queryId");
    const textColumn = findColumn(report, (column) => column.kind === "queryText");
    const cpuColumn = findColumn(report, isTotalCpuColumn);
    const executionsColumn = findColumn(report, (column) => column.kind === "executionCount");
    if (!report || !idColumn || !cpuColumn) {
        return [];
    }
    return report.rows.map((row) => {
        const totalCpuMs = numberOf(row, cpuColumn);
        const executions = executionsColumn ? numberOf(row, executionsColumn) : 0;
        return {
            queryId: String(row[idColumn.id] ?? ""),
            queryText: textColumn ? String(row[textColumn.id] ?? "") : "",
            ...(capacityMs ? { cpuPercent: (totalCpuMs / capacityMs) * 100 } : {}),
            totalCpuMs,
            ...(executions > 0 ? { cpuPerExecutionMs: totalCpuMs / executions } : {}),
            executions,
        };
    });
}

function isTotalCpuColumn(column: ReportColumn): boolean {
    return (
        column.kind === "statisticMetric" &&
        column.metric === "cpuTime" &&
        column.statistic === "total"
    );
}

function findColumn(
    report: QueryStoreReport | undefined,
    predicate: (column: ReportColumn) => boolean,
): ReportColumn | undefined {
    return report?.columns.find(predicate);
}

function numberOf(row: ReportRow, column: ReportColumn): number {
    const value = Number(row[column.id]);
    return Number.isFinite(value) ? value : 0;
}

function withValues(summary: { [K in keyof CpuSummary]: CpuSummary[K] | undefined }): CpuSummary {
    return Object.fromEntries(
        Object.entries(summary).filter(([, value]) => value !== undefined),
    ) as CpuSummary;
}
