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
    timeSeriesChartHeight,
} from "./performanceDashboardParts";
import {
    HistoryMetric,
    historyTitle,
    historyValue,
    intervalMinutesOf,
    useHistorySelection,
    useQueryHistory,
} from "./performanceDashboardPlanHistory";
import { filledSeriesPoints } from "./performanceDashboardSeries";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
import { ChartSkeleton, TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

/**
 * The runtime stats of the query over the time range, for all plans together: a chart of a
 * metric and statistic, and a table of each Query Store interval. The metric and statistic are
 * in the location; the query page shows their selects.
 */
export const PerformanceDashboardQueryHistory = ({ queryId }: { queryId: string }) => {
    const text = loc.performanceDashboard;
    const { range } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();
    const { metric, view } = useHistorySelection();
    const history = useQueryHistory(queryId);
    const data = readData(history);

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
    // The newest first.
    const rows = useMemo(() => [...(data ?? [])].reverse(), [data]);

    const message = readStatusMessage(history);
    if (message) {
        return <StatusBar message={message} />;
    }
    if (isFirstLoad(history)) {
        return (
            <ChartPanel chart={<ChartSkeleton height={timeSeriesChartHeight} />}>
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
                />
            }>
            {rows.length > 0 && (
                <SimpleGrid<QueryStoreInterval>
                    fill
                    virtualized
                    framed={false}
                    items={rows}
                    getRowId={(interval) => interval.startUtc}
                    ariaLabel={text.executionHistory}
                    columns={[
                        {
                            id: "interval",
                            header: text.timeInterval,
                            idealWidth: 260,
                            render: (interval) =>
                                text.timeIntervalRange(
                                    dateTimeFormat.format(new Date(interval.startUtc)),
                                    timeFormat.format(new Date(interval.endUtc)),
                                ),
                            compare: (left, right) =>
                                Date.parse(left.startUtc) - Date.parse(right.startUtc),
                        },
                        {
                            id: "executions",
                            header: text.executionCount,
                            numeric: true,
                            render: (interval) => formatNumber(interval.executionCount),
                            compare: (left, right) => left.executionCount - right.executionCount,
                        },
                        {
                            id: "duration",
                            header: text.totalDuration,
                            numeric: true,
                            render: (interval) => milliseconds(total(interval, "duration")),
                            compare: (left, right) =>
                                total(left, "duration") - total(right, "duration"),
                        },
                        {
                            id: "cpu",
                            header: text.totalCpu,
                            numeric: true,
                            render: (interval) => milliseconds(total(interval, "cpuTime")),
                            compare: (left, right) =>
                                total(left, "cpuTime") - total(right, "cpuTime"),
                        },
                        {
                            id: "reads",
                            header: text.logicalReads,
                            numeric: true,
                            render: (interval) =>
                                text.kilobytes(formatNumber(total(interval, "logicalReads"))),
                            compare: (left, right) =>
                                total(left, "logicalReads") - total(right, "logicalReads"),
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
