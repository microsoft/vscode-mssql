/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import type { QueryStoreInterval } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad } from "../../common/useExtensionRequest";
import { dateTimeFormat, formatNumber, timeFormat } from "./performanceDashboardFormat";
import {
    ChartPanel,
    StatusBar,
    TimeSeriesChart,
    readData,
    timeBandHeight,
    timeSeriesChartHeight,
} from "./performanceDashboardParts";
import { HistoryRow, historyRows, planBand, planIdsOf } from "./performanceDashboardPlanBand";
import { usePlanColor } from "./performanceDashboardPlanColors";
import {
    HistoryMetric,
    historyTitle,
    historyValue,
    intervalMinutesOf,
    useHistorySelection,
    useQueryHistory,
} from "./performanceDashboardPlanHistory";
import { useQueryPlans } from "./performanceDashboardQueryPlans";
import { filledSeriesPoints } from "./performanceDashboardSeries";
import { DashboardGrid, textSpan, withSwatch } from "./performanceDashboardGrid";
import { ChartSkeleton, TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

/** The widths of the history table, which the user can resize. Its space left is empty. */
const intervalWidth = 230;
const plansWidth = 96;
const numberWidth = 110;

/**
 * The runtime stats of the query over the time range, for all plans together: a chart of a
 * metric and statistic, with a band below it of the plan that ran most in each interval, and a
 * table of each Query Store interval and its plans. The metric and statistic are in the
 * location; the query page shows their selects.
 */
export const PerformanceDashboardQueryHistory = ({ queryId }: { queryId: string }) => {
    const text = loc.performanceDashboard;
    const { range } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();
    const { metric, view } = useHistorySelection();
    const history = useQueryHistory(queryId);
    const data = readData(history);
    const plansData = readData(useQueryPlans(queryId));

    // The plans have the colors of the Plans tab: every plan of the query, by plan ID. Until the
    // plans are read, the plans that ran in the history, in the same order.
    const planIds = useMemo(
        () => plansData?.map((plan) => plan.planId) ?? planIdsOf(data ?? []),
        [plansData, data],
    );
    const colorOf = usePlanColor(planIds);

    const points = useMemo(() => {
        const intervals = data ?? [];
        return filledSeriesPoints(
            intervals.map((interval) => ({
                startUtc: interval.startUtc,
                value: historyValue(interval, metric, view) ?? 0,
            })),
            intervalMinutesOf(intervals),
            range,
            availableFrom,
        );
    }, [data, metric, view, range, availableFrom]);
    // The oldest first, for the band; the table shows the newest first.
    const chronological = useMemo(() => historyRows(data ?? []), [data]);
    const rows = useMemo(() => [...chronological].reverse(), [chronological]);
    const band = useMemo(
        () => planBand(chronological, planIds, colorOf),
        [chronological, planIds, colorOf],
    );

    const message = readStatusMessage(history);
    if (message) {
        return <StatusBar message={message} />;
    }
    if (isFirstLoad(history)) {
        return (
            <ChartPanel chart={<ChartSkeleton height={timeSeriesChartHeight + timeBandHeight} />}>
                <TableSkeleton framed={false} rows={3} numberColumns={4} />
            </ChartPanel>
        );
    }
    const milliseconds = (value: number) => text.milliseconds(formatNumber(value));

    return (
        <ChartPanel
            chart={
                <TimeSeriesChart
                    title={historyTitle(metric, view)}
                    range={range}
                    yAxisTitle={historyTitle(metric, view)}
                    points={points}
                    format={formatNumber}
                    band={band}
                />
            }>
            {rows.length > 0 && (
                <DashboardGrid<HistoryRow>
                    // The cells draw the plan colors, which change when the plans are read.
                    key={planIds.join()}
                    framed={false}
                    items={rows}
                    getRowId={(row) => row.interval.startUtc}
                    ariaLabel={text.executionHistory}
                    columns={[
                        {
                            id: "interval",
                            header: text.timeInterval,
                            width: intervalWidth,
                            text: ({ interval }) =>
                                text.timeIntervalRange(
                                    dateTimeFormat.format(new Date(interval.startUtc)),
                                    timeFormat.format(new Date(interval.endUtc)),
                                ),
                            sortValue: ({ interval }) => Date.parse(interval.startUtc),
                        },
                        {
                            id: "plans",
                            header: text.plans,
                            width: plansWidth,
                            text: (row) => row.plans.map((plan) => plan.planId).join(", "),
                            title: (row) =>
                                row.plans
                                    .map((plan) =>
                                        text.planExecutions(
                                            plan.planId,
                                            formatNumber(plan.executionCount),
                                        ),
                                    )
                                    .join("\n"),
                            sortValue: (row) =>
                                row.plans[0] ? Number(row.plans[0].planId) : undefined,
                            render: (row) => plansCell(row, colorOf),
                        },
                        {
                            id: "executions",
                            header: text.executionCount,
                            numeric: true,
                            width: numberWidth,
                            text: ({ interval }) => formatNumber(interval.executionCount),
                            sortValue: ({ interval }) => interval.executionCount,
                        },
                        {
                            id: "duration",
                            header: text.totalDuration,
                            numeric: true,
                            width: numberWidth,
                            text: ({ interval }) => milliseconds(total(interval, "duration")),
                            sortValue: ({ interval }) => total(interval, "duration"),
                        },
                        {
                            id: "cpu",
                            header: text.totalCpu,
                            numeric: true,
                            width: numberWidth,
                            text: ({ interval }) => milliseconds(total(interval, "cpuTime")),
                            sortValue: ({ interval }) => total(interval, "cpuTime"),
                        },
                        {
                            id: "reads",
                            header: text.logicalReads,
                            numeric: true,
                            width: numberWidth,
                            text: ({ interval }) =>
                                text.kilobytes(formatNumber(total(interval, "logicalReads"))),
                            sortValue: ({ interval }) => total(interval, "logicalReads"),
                        },
                    ]}
                />
            )}
        </ChartPanel>
    );
};

/** The total of a metric in an interval, or 0 when the query did not run. */
function total(interval: QueryStoreInterval, metric: HistoryMetric): number {
    return interval.metrics[metric]?.total ?? 0;
}

/** The plans of an interval in their colors. */
function plansCell(row: HistoryRow, colorOf: (planId: string) => string): HTMLElement {
    const cell = document.createElement("span");
    cell.className = "performance-grid-plans";
    for (const plan of row.plans) {
        cell.append(withSwatch(colorOf(plan.planId), textSpan(plan.planId)));
    }
    return cell;
}
