/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands } from "@fluentui/react-components";
import {
    GetMetricSeriesRequest,
    GetMetricTotalsRequest,
    GetTopQueriesRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { cpuSummaryWindows } from "./performanceDashboardCpuModel";
import { formatMegabytes, formatNumber } from "./performanceDashboardFormat";
import {
    ReadOnlyNotice,
    SectionHeader,
    StatusBar,
    SummaryCard,
    TimeSeriesChart,
    isReadOnly,
    readData,
} from "./performanceDashboardParts";
import { PerformanceDashboardQueryList } from "./performanceDashboardQueryGrid";
import { queryListRows } from "./performanceDashboardQueryList";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { averageChange, bucketMinutesFor, filledSeriesPoints } from "./performanceDashboardSeries";
import { readStatusMessage } from "./performanceDashboardStatus";
import {
    queryLinkRange,
    useQueryStoreAvailableFrom,
    useViewTimeRange,
} from "./performanceDashboardTimeRange";

const topQueryCount = 10;

const useStyles = makeStyles({
    view: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
    },
});

/**
 * The memory that queries were granted, from Query Store: the average grant for each
 * execution, the peak grant for each time bucket, and the queries with the largest grants.
 */
export const PerformanceDashboardMemoryView = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { match } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const key = [databaseName, refreshKey];
    const { range, window, now } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();

    const totals = useExtensionRequest(
        GetMetricTotalsRequest.type,
        { metric: "memoryConsumption", windows: cpuSummaryWindows(range, now) },
        key,
    );
    const series = useExtensionRequest(
        GetMetricSeriesRequest.type,
        { ...window, metric: "memoryConsumption", bucketMinutes: bucketMinutesFor(range) },
        key,
    );
    const topQueries = useExtensionRequest(
        GetTopQueriesRequest.type,
        { ...window, metric: "memoryConsumption", statistic: "max", top: topQueryCount },
        key,
    );

    const blocking = readStatusMessage(totals);
    if (blocking) {
        return <StatusBar message={blocking} />;
    }

    const windows = readData(totals)?.windows ?? [];
    const [inRange, last24Hours, previous24Hours, last7Days, previous7Days] = windows;
    const averageKb =
        inRange && inRange.executionCount > 0 ? inRange.total / inRange.executionCount : undefined;
    const seriesData = readData(series);
    const peakKb = seriesData?.buckets.reduce((max, bucket) => Math.max(max, bucket.max ?? 0), 0);
    const points = seriesData
        ? filledSeriesPoints(
              seriesData.buckets.map((bucket) => ({
                  startUtc: bucket.startUtc,
                  value: (bucket.max ?? 0) / 1024,
              })),
              seriesData.bucketMinutes,
              range,
              availableFrom,
          )
        : [];

    return (
        <div className={classes.view}>
            {isReadOnly(totals) && <ReadOnlyNotice />}
            <SummaryCard
                value={averageKb !== undefined ? formatMegabytes(averageKb) : text.notAvailable}
                caption={text.averageMemoryGrant}
                info={text.memoryGrantInfo}
                loading={totals.loading && windows.length === 0}
                figures={
                    peakKb !== undefined
                        ? [{ label: text.peakMemoryGrant, value: formatMegabytes(peakKb) }]
                        : []
                }
                changes={[
                    {
                        label: text.overLast24Hours,
                        value: averageChange(last24Hours, previous24Hours, availableFrom),
                    },
                    {
                        label: text.overLast7Days,
                        value: averageChange(last7Days, previous7Days, availableFrom),
                    },
                ]}
            />
            <TimeSeriesChart
                title={text.peakMemoryGrantMb}
                points={points}
                format={(megabytes) => formatMegabytes(megabytes * 1024)}
                read={series}
                message={readStatusMessage(series)}
            />
            <SectionHeader title={text.highMemoryGrantQueries} />
            <PerformanceDashboardQueryList
                read={topQueries}
                rows={queryListRows(readData(topQueries))}
                columns={[
                    {
                        id: "maxGrant",
                        header: text.maxMemoryGrant,
                        value: (row) => row.value,
                        format: formatMegabytes,
                    },
                    {
                        id: "executions",
                        header: text.executionCount,
                        value: (row) => row.executions,
                        format: formatNumber,
                    },
                ]}
                ariaLabel={text.highMemoryGrantQueries}
                linkQuery={queryLinkRange(match.query)}
            />
        </div>
    );
};
