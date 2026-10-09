/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type {
    MetricWindowTotal,
    QueryStoreReport,
} from "../../../src/sharedInterfaces/performance";
import {
    cpuCapacityMs,
    cpuChartPoints,
    cpuCoreCount,
    cpuSummary,
    cpuSummaryWindows,
    relativeChange,
    topQueryRows,
} from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardCpuModel";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const now = new Date(Date.UTC(2026, 9, 8, 12));
const range = { from: new Date(now.getTime() - dayMs), to: now };

function total(start: number, end: number, totalMs: number): MetricWindowTotal {
    return {
        startUtc: new Date(start).toISOString(),
        endUtc: new Date(end).toISOString(),
        total: totalMs,
        executionCount: totalMs > 0 ? 10 : 0,
    };
}

/** The five summary windows, with the given CPU milliseconds. */
function summaryTotals(
    rangeMs: number,
    last24: number,
    previous24: number,
    last7: number,
    previous7: number,
): MetricWindowTotal[] {
    const end = now.getTime();
    return [
        total(range.from.getTime(), end, rangeMs),
        total(end - dayMs, end, last24),
        total(end - 2 * dayMs, end - dayMs, previous24),
        total(end - 7 * dayMs, end, last7),
        total(end - 14 * dayMs, end - 7 * dayMs, previous7),
    ];
}

suite("Performance dashboard CPU", () => {
    test("asks for the range, the last 24 hours and 7 days, and the periods before them", () => {
        expect(cpuSummaryWindows(range, now).map((window) => window.startUtc)).to.deep.equal([
            "2026-10-07T12:00:00.000Z",
            "2026-10-07T12:00:00.000Z",
            "2026-10-06T12:00:00.000Z",
            "2026-10-01T12:00:00.000Z",
            "2026-09-24T12:00:00.000Z",
        ]);
    });

    test("estimates the average CPU use in percent of the cores", () => {
        // 8 cores busy 25% of a day: 2 core-days of CPU time.
        const summary = cpuSummary(summaryTotals(2 * dayMs, 2 * dayMs, dayMs, 0, 0), 8, undefined);

        expect(summary.averagePercent).to.be.closeTo(25, 1e-9);
        expect(summary.change24Hours).to.be.closeTo(100, 1e-9);
        expect(summary.change7Days).to.be.undefined;
        expect(summary.averageBusyCores).to.be.undefined;
    });

    test("gives busy cores without the core count", () => {
        const summary = cpuSummary(summaryTotals(dayMs / 2, 0, 0, 0, 0), undefined, undefined);

        expect(summary.averageBusyCores).to.be.closeTo(0.5, 1e-9);
        expect(summary.averagePercent).to.be.undefined;
    });

    test("averages only over the time that Query Store has data for", () => {
        // Data for the last 6 hours: 6 core-hours on 4 cores is 25%.
        const availableFrom = new Date(now.getTime() - 6 * hourMs);
        const summary = cpuSummary(summaryTotals(6 * hourMs, 0, 0, 0, 0), 4, availableFrom);

        expect(summary.averagePercent).to.be.closeTo(25, 1e-9);
    });

    test("compares a period only when Query Store covers the period before it", () => {
        const current = total(0, dayMs, 110);
        const previous = total(-dayMs, 0, 100);

        expect(relativeChange(current, previous, undefined)).to.be.closeTo(10, 1e-9);
        expect(relativeChange(current, previous, new Date(-dayMs))).to.be.closeTo(10, 1e-9);
        expect(relativeChange(current, previous, new Date(-dayMs + 1))).to.be.undefined;
        expect(relativeChange(current, total(-dayMs, 0, 0), undefined)).to.be.undefined;
        expect(relativeChange(total(0, dayMs, 50), previous, undefined)).to.be.closeTo(-50, 1e-9);
    });

    test("charts each bucket, with zero for a bucket without rows", () => {
        const report: QueryStoreReport = {
            columns: [
                {
                    id: "total_cpu_time",
                    kind: "statisticMetric",
                    valueType: "number",
                    metric: "cpuTime",
                    statistic: "total",
                },
                { id: "bucket_start", kind: "bucketStartTime", valueType: "date" },
                { id: "bucket_end", kind: "bucketEndTime", valueType: "date" },
            ],
            rows: [
                {
                    total_cpu_time: hourMs,
                    bucket_start: "2026-10-08T09:00:00.000Z",
                    bucket_end: "2026-10-08T10:00:00.000Z",
                },
                {
                    total_cpu_time: 2 * hourMs,
                    bucket_start: "2026-10-08T11:00:00.000Z",
                    bucket_end: "2026-10-08T12:00:00.000Z",
                },
            ],
        };
        const availableFrom = new Date(Date.UTC(2026, 9, 8, 8, 30));

        const points = cpuChartPoints(report, range, availableFrom, 4);

        expect(points.map((point) => [point.x.toISOString(), point.y])).to.deep.equal([
            ["2026-10-08T08:00:00.000Z", 0],
            ["2026-10-08T09:00:00.000Z", 25],
            ["2026-10-08T10:00:00.000Z", 0],
            ["2026-10-08T11:00:00.000Z", 50],
        ]);
        expect(cpuChartPoints(undefined, range, undefined, 4)).to.deep.equal([]);
    });

    test("maps the top queries with the CPU time per execution", () => {
        const report: QueryStoreReport = {
            columns: [
                { id: "query_id", kind: "queryId", valueType: "id" },
                { id: "query_sql_text", kind: "queryText", valueType: "text" },
                {
                    id: "total_cpu_time",
                    kind: "statisticMetric",
                    valueType: "number",
                    metric: "cpuTime",
                    statistic: "total",
                },
                {
                    id: "count_executions",
                    kind: "executionCount",
                    valueType: "number",
                    metric: "executionCount",
                },
            ],
            rows: [
                {
                    query_id: "876",
                    query_sql_text: "SELECT 1",
                    total_cpu_time: 5210,
                    count_executions: 10,
                },
                {
                    query_id: "913",
                    query_sql_text: "SELECT 2",
                    total_cpu_time: 0,
                    count_executions: 0,
                },
            ],
        };

        expect(topQueryRows(report, 10 * 5210)).to.deep.equal([
            {
                queryId: "876",
                queryText: "SELECT 1",
                cpuPercent: 10,
                totalCpuMs: 5210,
                cpuPerExecutionMs: 521,
                executions: 10,
            },
            {
                queryId: "913",
                queryText: "SELECT 2",
                cpuPercent: 0,
                totalCpuMs: 0,
                executions: 0,
            },
        ]);
        expect(topQueryRows(report)[0].cpuPercent).to.be.undefined;
    });

    test("measures CPU against vCores or logical CPUs, but not a count of 0", () => {
        expect(cpuCoreCount({ vCores: 8 })).to.equal(8);
        expect(cpuCoreCount({ logicalCpus: 16 })).to.equal(16);
        expect(cpuCoreCount({ edition: "Basic", vCores: 0 })).to.be.undefined;
        expect(cpuCoreCount(undefined)).to.be.undefined;
    });

    test("gives the CPU capacity of the range from the oldest data", () => {
        expect(cpuCapacityMs(range, undefined, 4)).to.equal(4 * dayMs);
        expect(cpuCapacityMs(range, new Date(now.getTime() - hourMs), 2)).to.equal(2 * hourMs);
        expect(cpuCapacityMs(range, undefined, undefined)).to.be.undefined;
        expect(cpuCapacityMs(range, now, 4)).to.be.undefined;
    });
});
