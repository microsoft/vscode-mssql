/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import {
    GetMetricSeriesRequest,
    GetMetricTotalsRequest,
    GetTopQueriesRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { cpuSummaryWindows, relativeChange } from "./performanceDashboardCpuModel";
import { formatNumber } from "./performanceDashboardFormat";
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
import { dataStart, filledSeriesPoints } from "./performanceDashboardSeries";
import { readStatusMessage } from "./performanceDashboardStatus";
import {
    queryLinkRange,
    useQueryStoreAvailableFrom,
    useViewTimeRange,
} from "./performanceDashboardTimeRange";

/** Requests are counted for each 15 minutes. */
const requestBucketMinutes = 15;
const topQueryCount = 10;

const useStyles = makeStyles({
    view: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
        ...shorthands.gap("16px"),
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
});

/**
 * The requests of the database from Query Store: the executions for each 15 minutes, and the
 * queries that ran most often.
 */
export const PerformanceDashboardRequestsView = () => {
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
        { metric: "executionCount", windows: cpuSummaryWindows(range, now) },
        key,
    );
    const series = useExtensionRequest(
        GetMetricSeriesRequest.type,
        { ...window, metric: "executionCount", bucketMinutes: requestBucketMinutes },
        key,
    );
    const topQueries = useExtensionRequest(
        GetTopQueriesRequest.type,
        { ...window, metric: "executionCount", top: topQueryCount },
        key,
    );

    const blocking = readStatusMessage(totals);
    if (blocking) {
        return <StatusBar message={blocking} />;
    }

    const windows = readData(totals)?.windows ?? [];
    const [inRange, last24Hours, previous24Hours, last7Days, previous7Days] = windows;
    const periods =
        (range.to.getTime() - dataStart(range, availableFrom)) / (requestBucketMinutes * 60_000);
    const perPeriod = inRange && periods > 0 ? inRange.total / periods : undefined;

    const seriesData = readData(series);
    const bucketMinutes = seriesData?.bucketMinutes ?? requestBucketMinutes;
    const points = seriesData
        ? filledSeriesPoints(
              seriesData.buckets.map((bucket) => ({
                  startUtc: bucket.startUtc,
                  value: bucket.executionCount,
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
                value={perPeriod !== undefined ? formatNumber(perPeriod) : text.notAvailable}
                label={text.averageRequestsPer15Minutes}
                info={text.requestsInfo}
                loading={totals.loading && windows.length === 0}
                figures={
                    inRange
                        ? [{ label: text.totalRequests, value: formatNumber(inRange.total) }]
                        : []
                }
                changes={[
                    {
                        label: text.overLast24Hours,
                        value: relativeChange(last24Hours, previous24Hours, availableFrom),
                    },
                    {
                        label: text.overLast7Days,
                        value: relativeChange(last7Days, previous7Days, availableFrom),
                    },
                ]}>
                <TimeSeriesChart
                    title={text.requestsPerMinutes(formatNumber(bucketMinutes))}
                    points={points}
                    format={formatNumber}
                    read={series}
                    message={readStatusMessage(series)}
                />
            </SummaryCard>
            {bucketMinutes > requestBucketMinutes && (
                <Caption1 className={classes.note}>
                    {text.coarserBuckets(formatNumber(bucketMinutes))}
                </Caption1>
            )}
            <SectionHeader title={text.mostFrequentQueries} />
            <PerformanceDashboardQueryList
                read={topQueries}
                rows={queryListRows(readData(topQueries))}
                columns={[
                    {
                        id: "executions",
                        header: text.executionCount,
                        value: (row) => row.executions,
                        format: formatNumber,
                    },
                ]}
                ariaLabel={text.mostFrequentQueries}
                linkQuery={queryLinkRange(match.query)}
            />
        </div>
    );
};
