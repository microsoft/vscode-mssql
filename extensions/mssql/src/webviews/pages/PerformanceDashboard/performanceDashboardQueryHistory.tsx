/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QueryHistoryInterval } from "../../../sharedInterfaces/performance";
import { GetQueryHistoryRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { dateTimeFormat, formatNumber, timeFormat } from "./performanceDashboardFormat";
import {
    ChartPanel,
    StatusBar,
    TimeSeriesChart,
    readData,
    timeSeriesChartHeight,
} from "./performanceDashboardParts";
import {
    historyTitle,
    historyValue,
    intervalMinutesOf,
    useHistorySelection,
} from "./performanceDashboardPlanHistory";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
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
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range, window } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();
    const { metric, view } = useHistorySelection();

    const history = useExtensionRequest(GetQueryHistoryRequest.type, { queryId, ...window }, [
        databaseName,
        refreshKey,
    ]);

    const message = readStatusMessage(history);
    if (message) {
        return <StatusBar message={message} />;
    }
    const intervals = readData(history)?.intervals ?? [];
    if (isFirstLoad(history)) {
        return (
            <ChartPanel chart={<ChartSkeleton height={timeSeriesChartHeight} />}>
                <TableSkeleton framed={false} rows={3} numberColumns={4} />
            </ChartPanel>
        );
    }

    const points = filledSeriesPoints(
        intervals.map((interval) => ({
            startUtc: interval.startUtc,
            value: historyValue(interval, metric, view) ?? 0,
        })),
        intervalMinutesOf(intervals),
        range,
        availableFrom,
    );
    const milliseconds = (value: number) => text.milliseconds(formatNumber(value));

    return (
        <ChartPanel
            chart={
                <TimeSeriesChart
                    title={historyTitle(metric, view)}
                    points={points}
                    format={formatNumber}
                    read={history}
                />
            }>
            {intervals.length > 0 && (
                <SimpleGrid<QueryHistoryInterval>
                    framed={false}
                    items={[...intervals].reverse()}
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
                            render: (interval) => milliseconds(interval.totalDurationMs),
                            compare: (left, right) => left.totalDurationMs - right.totalDurationMs,
                        },
                        {
                            id: "cpu",
                            header: text.totalCpu,
                            numeric: true,
                            render: (interval) => milliseconds(interval.totalCpuMs),
                            compare: (left, right) => left.totalCpuMs - right.totalCpuMs,
                        },
                        {
                            id: "reads",
                            header: text.logicalReads,
                            numeric: true,
                            render: (interval) =>
                                text.pages(formatNumber(interval.totalLogicalReads)),
                            compare: (left, right) =>
                                left.totalLogicalReads - right.totalLogicalReads,
                        },
                    ]}
                />
            )}
        </ChartPanel>
    );
};
